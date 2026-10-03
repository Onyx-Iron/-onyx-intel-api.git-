"use client";

/**
 * Client-side Google authorization via GIS token flow — needs NO redirect URI
 * and NO client secret (works off the OAuth client's authorized JS origins).
 * One consent grants every scope the app uses; the token is cached for the
 * session and silently refreshed. Used by all Google features (Gmail, Calendar,
 * Docs, Drive, Sheets) so the user connects once.
 */

import { GOOGLE_SCOPES } from "./scopes";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export { GOOGLE_SCOPES };

const TOKEN_KEY = "onyx_g_token";
const EXP_KEY = "onyx_g_exp";

function loadGis(): Promise<void> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) { existing.addEventListener("load", () => resolve()); if (window.google) resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
}

function store(token: string, expiresIn: number) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EXP_KEY, String(Date.now() + (expiresIn || 3600) * 1000));
}

export function isGoogleLinked(): boolean {
  try { return !!sessionStorage.getItem(TOKEN_KEY); } catch { return false; }
}

export function disconnectGoogle() {
  try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(EXP_KEY); } catch { /* noop */ }
}

function requestToken(prompt: "consent" | ""): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error("google_auth_not_loaded"));
      return;
    }
    const tc = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: GOOGLE_SCOPES,
      // Do not pull in unrelated prior grants on this OAuth client (YouTube,
      // Analytics, etc.) — Google rejects those when mixed with Drive scopes.
      include_granted_scopes: false,
      callback: (resp) => {
        if (resp.access_token) { store(resp.access_token, resp.expires_in ?? 3600); resolve(resp.access_token); }
        else resolve(null);
      },
      error_callback: (err: { type?: string }) => {
        if (err?.type === "popup_closed") resolve(null);
        else reject(new Error(err?.type ?? "google_auth_error"));
      },
    });
    tc.requestAccessToken({ prompt });
  });
}

/** Interactive connect — shows the consent popup. Returns the token or null if cancelled. */
export async function connectGoogle(): Promise<string | null> {
  if (!CLIENT_ID) throw new Error("Google client ID is not configured.");
  await loadGis();
  return requestToken("consent");
}

/** Returns a valid token, refreshing silently if needed. Falls back to interactive. */
export async function getGoogleToken(): Promise<string | null> {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const exp = Number(sessionStorage.getItem(EXP_KEY) || 0);
    if (t && exp > Date.now() + 60_000) return t;
  } catch { /* ignore */ }
  await loadGis();
  const silent = await requestToken("");
  if (silent) return silent;
  return requestToken("consent");
}
