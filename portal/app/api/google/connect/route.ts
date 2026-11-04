import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google/oauth";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  createGoogleOAuthState,
  googleOAuthStateCookie,
} from "@/lib/google/oauth-state";

export const runtime = "nodejs";

// Kicks off the Google connect flow — redirects the user to Google's consent.
export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = createGoogleOAuthState(userId);
  const response = NextResponse.redirect(buildAuthUrl(state));
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, googleOAuthStateCookie());
  return response;
}
