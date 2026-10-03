import { createServiceClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/appUrl";
import { headerSafe } from "@/lib/http";
import { GOOGLE_SCOPES } from "./scopes";

/**
 * Server-side Google OAuth — connect once, use everywhere.
 * One consent grants Drive/Sheets/Gmail/Calendar/Docs; the refresh token is
 * stored per (tenant,user) and minted into short-lived access tokens on demand.
 */

const CLIENT_ID     = headerSafe(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
const CLIENT_SECRET = headerSafe(process.env.GOOGLE_CLIENT_SECRET);
export const REDIRECT_URI =
  headerSafe(process.env.GOOGLE_REDIRECT_URI) || `${getAppOrigin()}/api/google/callback`;

export { GOOGLE_SCOPES };

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",   // get a refresh token
    prompt: "consent",        // ensure a refresh token is returned
    // false: prior grants on this client (e.g. YouTube) cannot be requested
    // together with Drive scopes and fail consent with invalid_request.
    include_granted_scopes: "false",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8"));
    return payload.email ?? null;
  } catch { return null; }
}

export async function exchangeCode(code: string): Promise<{ refresh_token: string; access_token: string; expires_in: number; email: string | null; scope: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
    }),
  });
  const data = await res.json() as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`[google token] ${data.error_description ?? data.error ?? res.status}`);
  }
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token. Disconnect the app from your Google account and reconnect.");
  }
  return {
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expires_in: data.expires_in ?? 3600,
    email: emailFromIdToken(data.id_token),
    scope: data.scope ?? GOOGLE_SCOPES,
  };
}

/**
 * Returns a valid access token for the user, refreshing if needed.
 * Returns null in BOTH cases: "not connected" and "refresh failed" — the latter
 * is logged with detail so server logs distinguish them. Callers that need to
 * distinguish should call `getAccessTokenWithReason` instead.
 */
export async function getAccessToken(tenantId: string, userId: string): Promise<string | null> {
  const r = await getAccessTokenWithReason(tenantId, userId);
  return r.token;
}

export type AccessTokenReason = "ok" | "not_connected" | "refresh_failed";

/** Like getAccessToken but returns the reason a null was produced. */
export async function getAccessTokenWithReason(
  tenantId: string,
  userId: string,
): Promise<{ token: string | null; reason: AccessTokenReason; detail?: string }> {
  const db = await createServiceClient();
  const { data: conn } = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("google_connections" as any)
    .select("refresh_token, access_token, access_expires_at")
    .eq("tenant_id", tenantId).eq("user_id", userId).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = conn as any;
  if (!c?.refresh_token) {
    return { token: null, reason: "not_connected" };
  }

  const now = Date.now();
  if (c.access_token && c.access_expires_at && new Date(c.access_expires_at).getTime() > now + 60_000) {
    return { token: c.access_token as string, reason: "ok" };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: c.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json() as TokenResponse;
  if (!res.ok || !data.access_token) {
    const detail = `${res.status} ${data.error ?? ""} ${data.error_description ?? ""}`.trim();
    // Surface refresh failures in server logs — they're invisible to callers that just see null.
    console.warn(`[google.oauth] refresh failed for tenant=${tenantId} user=${userId}: ${detail}`);
    return { token: null, reason: "refresh_failed", detail };
  }

  const expiresAt = new Date(now + (data.expires_in ?? 3600) * 1000).toISOString();
  await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("google_connections" as any)
    .update({ access_token: data.access_token, access_expires_at: expiresAt })
    .eq("tenant_id", tenantId).eq("user_id", userId);
  return { token: data.access_token, reason: "ok" };
}

export async function isConnected(tenantId: string, userId: string): Promise<{ connected: boolean; email: string | null }> {
  const db = await createServiceClient();
  const { data } = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("google_connections" as any)
    .select("email").eq("tenant_id", tenantId).eq("user_id", userId).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = data as any;
  return { connected: !!c, email: c?.email ?? null };
}

export async function saveConnection(tenantId: string, userId: string, refreshToken: string, accessToken: string, expiresIn: number, email: string | null, scope: string): Promise<void> {
  const db = await createServiceClient();
  await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("google_connections" as any)
    .upsert({
      tenant_id: tenantId, user_id: userId, email, refresh_token: refreshToken,
      access_token: accessToken, access_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: scope, updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,user_id" });
}
