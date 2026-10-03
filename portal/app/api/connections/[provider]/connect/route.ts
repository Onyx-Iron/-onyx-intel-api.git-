import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  buildProviderAuthUrl,
  type OAuthHubProvider,
} from "@/lib/connections/oauthProviders";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

const VALID = new Set<OAuthHubProvider>([
  "dropbox", "sharefile", "meta", "gbp", "gsc", "linkedin",
]);

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", _req.url));

  const { provider: raw } = await ctx.params;
  if (!VALID.has(raw as OAuthHubProvider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }
  const provider = raw as OAuthHubProvider;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const state = Buffer.from(JSON.stringify({ tenantId, userId, provider, t: Date.now() })).toString("base64url");
  const url = buildProviderAuthUrl(provider, state);
  if (!url) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings/connections?error=${provider}_not_configured`, _req.url),
    );
  }
  return NextResponse.redirect(url);
}
