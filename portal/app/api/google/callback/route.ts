import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveConnection } from "@/lib/google/oauth";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  googleOAuthStateCookie,
  googleOAuthStateMatches,
  googleOAuthStateUserId,
} from "@/lib/google/oauth-state";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

function clearOAuthState(response: NextResponse): NextResponse {
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", googleOAuthStateCookie(0));
  return response;
}

// Google redirects here with ?code=... after consent. Exchange + store, then back to the app.
export async function GET(req: NextRequest): Promise<Response> {
  const base = req.nextUrl.origin;
  let stateBound = false;
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.redirect(`${base}/dashboard?google=error&reason=not_signed_in`);

    const code = req.nextUrl.searchParams.get("code");
    const err = req.nextUrl.searchParams.get("error");
    const state = req.nextUrl.searchParams.get("state") ?? "";
    if (err) return NextResponse.redirect(`${base}/dashboard?google=error&reason=${encodeURIComponent(err)}`);
    if (!code) return NextResponse.redirect(`${base}/dashboard?google=error&reason=no_code`);

    // The connect route stores the full state in an httpOnly cookie. Checking
    // only that the state starts with the Clerk user id is not a CSRF bind:
    // that id is not a secret, so an attacker can finish their own Google
    // consent with state `${victimUserId}.<anything>` and send the victim the
    // callback. The victim's session matches the prefix and saveConnection
    // upserts the attacker's refresh token over the workspace Google account.
    const cookieState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
    if (!googleOAuthStateMatches(cookieState, state) || googleOAuthStateUserId(state) !== userId) {
      return NextResponse.redirect(`${base}/dashboard?google=error&reason=state_mismatch`);
    }
    stateBound = true;

    const tok = await exchangeCode(code);
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await saveConnection(tenantId, userId, tok.refresh_token, tok.access_token, tok.expires_in, tok.email, tok.scope);

    return clearOAuthState(NextResponse.redirect(`${base}/dashboard?google=connected`));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const response = NextResponse.redirect(`${base}/dashboard?google=error&reason=${encodeURIComponent(msg.slice(0, 120))}`);
    // A forged callback must not burn the cookie from a connect still in flight.
    return stateBound ? clearOAuthState(response) : response;
  }
}
