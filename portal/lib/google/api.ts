import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAccessToken } from "./oauth";

async function getOrCreateTenant(orgId: string, orgName: string): Promise<string> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("tenants")
    .upsert({ clerk_org_id: orgId, name: orgName }, { onConflict: "clerk_org_id" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`[tenant] ${error?.message ?? "create failed"}`);
  return data.id;
}

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

  const tenantId = await getOrCreateTenant(orgId ?? `user_${userId}`, orgSlug ?? userId);
  const token = await getAccessToken(tenantId, userId);
  if (!token) return { ok: false, error: "Google account isn't connected. Click 'Connect Google' first.", status: 412, code: "NOT_CONNECTED" };
  return { ok: true, token, userId };
}
