import { NextRequest, NextResponse } from "next/server";
import {
  exchangeProviderCode,
  type OAuthHubProvider,
} from "@/lib/connections/oauthProviders";
import { upsertTenantConnection } from "@/lib/connections/store";

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

  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  if (!code || !stateRaw) return fail("missing_code");

  let state: { tenantId: string; userId: string; provider: string };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch {
    return fail("bad_state");
  }
  if (state.provider !== provider) return fail("state_mismatch");

  try {
    const tokens = await exchangeProviderCode(provider, code);
    await upsertTenantConnection({
      tenantId: state.tenantId,
      userId: state.userId,
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
