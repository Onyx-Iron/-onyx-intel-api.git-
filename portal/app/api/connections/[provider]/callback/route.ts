import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeProviderCode,
  type OAuthHubProvider,
} from "@/lib/connections/oauthProviders";
import { oauthCallbackStateMatchesSession } from "@/lib/connections/oauthState";
import { upsertTenantConnection } from "@/lib/connections/store";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";

export const runtime = "nodejs";

const VALID = new Set<OAuthHubProvider>([
  "dropbox", "sharefile", "meta", "gbp", "gsc", "linkedin",
]);

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { provider: raw } = await ctx.params;
  const origin = new URL(req.url).origin;
  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/dashboard/settings/connections?error=${encodeURIComponent(msg)}`);

  if (!VALID.has(raw as OAuthHubProvider)) return fail("unknown_provider");
  const provider = raw as OAuthHubProvider;

  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return fail("not_signed_in");

  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  if (!code || !stateRaw) return fail("missing_code");

  let state: { tenantId?: unknown; userId?: unknown; provider?: unknown };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch {
    return fail("bad_state");
  }

  // State is unsigned. Bind the stored tokens to the Clerk session, matching
  // /api/google/callback, so a redirect cannot attach this code to another account.
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  if (!oauthCallbackStateMatchesSession(state, { tenantId, userId, provider })) {
    return fail("state_mismatch");
  }

  try {
    const tokens = await exchangeProviderCode(provider, code);
    await upsertTenantConnection({
      tenantId,
      userId,
      provider,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      accessExpiresAt: tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : null,
      externalAccountLabel: tokens.label ?? provider,
      status: "connected",
    });
    return NextResponse.redirect(`${origin}/dashboard/settings/connections?connected=${provider}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg.slice(0, 120));
  }
}
