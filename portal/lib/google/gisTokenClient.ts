/**
 * Shared GIS token-client factory + script loader.
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

const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Load the GIS script once; wait for onload even if the tag already exists. */
export function loadGisScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2 || window.__gisLoaded) {
      window.__gisLoaded = true;
      return resolve();
    }
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        window.__gisLoaded = true;
        resolve();
      });
      if (window.google?.accounts?.oauth2) {
        window.__gisLoaded = true;
        resolve();
      }
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      window.__gisLoaded = true;
      resolve();
    };
    document.head.appendChild(s);
  });
}

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
