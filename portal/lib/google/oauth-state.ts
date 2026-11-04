import { randomBytes, timingSafeEqual } from "node:crypto";

/** httpOnly cookie that binds a Google OAuth callback to the browser that started it. */
export const GOOGLE_OAUTH_STATE_COOKIE = "onyx_google_oauth_state";

const STATE_MAX_AGE_SECONDS = 10 * 60;

export function createGoogleOAuthState(userId: string): string {
  return `${userId}.${randomBytes(16).toString("hex")}`;
}

/** User id is the segment before the first dot. The rest is an unguessable nonce. */
export function googleOAuthStateUserId(state: string): string {
  const dot = state.indexOf(".");
  if (dot <= 0) return "";
  return state.slice(0, dot);
}

/**
 * The callback query must be the exact state this browser received at connect
 * time. Matching only the user-id prefix is not enough: that prefix is the
 * Clerk id, and an attacker can put the victim's id in a state they minted.
 */
export function googleOAuthStateMatches(cookieValue: string | undefined, queryState: string): boolean {
  if (!cookieValue || !queryState) return false;
  const expected = Buffer.from(cookieValue);
  const actual = Buffer.from(queryState);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function googleOAuthStateCookie(maxAge: number = STATE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/google",
    maxAge,
  };
}
