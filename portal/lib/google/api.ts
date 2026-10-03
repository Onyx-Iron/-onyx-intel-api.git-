import { auth } from "@clerk/nextjs/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { getAccessToken } from "./oauth";

export type TokenResult =
  | { ok: true; token: string; userId: string }
  | { ok: false; error: string; status: number; code?: string };

/**
 * Resolve a valid Google access token. Prefers a client-supplied token from the
 * `X-Google-Token` header (GIS popup flow — no redirect URI needed); falls back
 * to a stored server-side token if the OAuth-code flow was ever used.
 */
export async function requireGoogleToken(req?: Request): Promise<TokenResult> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized", status: 401 };

  const headerToken = req?.headers.get("x-google-token");
  if (headerToken) return { ok: true, token: headerToken, userId };

  // Use the canonical tenant helper (seeds starter catalog) — do not duplicate
  // a bare insert that leaves new tenants with an empty price book.
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const token = await getAccessToken(tenantId, userId);
  if (!token) return { ok: false, error: "Google account isn't connected. Click 'Connect Google' first.", status: 412, code: "NOT_CONNECTED" };
  return { ok: true, token, userId };
}
