/**
 * OAuth `state` for hub providers is base64url JSON, not a signature.
 * The callback must ignore tenant/user ids inside it unless they match the
 * Clerk session that is completing the redirect. Otherwise a signed-in user
 * can be sent to
 * `/api/connections/:provider/callback?code=...&state=<other account>`
 * and the authorization code (their Dropbox, ShareFile, Meta, or Google
 * token) is stored on the account named in `state`.
 */
export interface OAuthCallbackState {
  tenantId?: unknown;
  userId?: unknown;
  provider?: unknown;
}

export function oauthCallbackStateMatchesSession(
  state: OAuthCallbackState,
  session: { tenantId: string; userId: string; provider: string },
): boolean {
  return (
    typeof state.tenantId === "string"
    && state.tenantId.length > 0
    && typeof state.userId === "string"
    && state.userId.length > 0
    && state.tenantId === session.tenantId
    && state.userId === session.userId
    && state.provider === session.provider
  );
}
