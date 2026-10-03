/**
 * Shared GIS token-client factory.
 *
 * Always sets include_granted_scopes:false — GIS defaults to true, which merges
 * prior grants on this OAuth client (e.g. YouTube) into the request and Google
 * rejects incompatible combos with drive.file as invalid_request.
 */

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};

type TokenError = { type?: string; message?: string };

export type GisTokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
};

export function createGisTokenClient(opts: {
  clientId: string;
  scope: string;
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: TokenError) => void;
}): GisTokenClient {
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error("google_auth_not_loaded");
  }
  return oauth2.initTokenClient({
    client_id: opts.clientId,
    scope: opts.scope,
    include_granted_scopes: false,
    callback: opts.callback,
    error_callback: opts.error_callback,
  });
}
