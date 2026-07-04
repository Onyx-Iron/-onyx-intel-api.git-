import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeCode, saveConnection } from "@/lib/google/oauth";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

// Google redirects here with ?code=... after consent. Exchange + store, then back to the app.
export async function GET(req: NextRequest): Promise<Response> {
  const base = req.nextUrl.origin;
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.redirect(`${base}/dashboard?google=error&reason=not_signed_in`);

    const code = req.nextUrl.searchParams.get("code");
    const err = req.nextUrl.searchParams.get("error");
    const state = req.nextUrl.searchParams.get("state") ?? "";
    if (err) return NextResponse.redirect(`${base}/dashboard?google=error&reason=${encodeURIComponent(err)}`);
    if (!code) return NextResponse.redirect(`${base}/dashboard?google=error&reason=no_code`);

    // CSRF guard: `/api/google/connect` sets state = `${userId}.<random>`. Reject
    // callbacks whose state doesn't bind to the currently signed-in Clerk user —
    // otherwise an attacker could redirect the flow and stash their Google
    // account under a victim's tenant.
    const stateUserId = state.split(".")[0];
    if (!stateUserId || stateUserId !== userId) {
      return NextResponse.redirect(`${base}/dashboard?google=error&reason=state_mismatch`);
    }

    const tok = await exchangeCode(code);
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await saveConnection(tenantId, userId, tok.refresh_token, tok.access_token, tok.expires_in, tok.email, tok.scope);

    return NextResponse.redirect(`${base}/dashboard?google=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(`${base}/dashboard?google=error&reason=${encodeURIComponent(msg.slice(0, 120))}`);
  }
}
