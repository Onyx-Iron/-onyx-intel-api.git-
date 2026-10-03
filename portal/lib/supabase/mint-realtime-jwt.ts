import { createHmac } from "node:crypto";

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Mint a short-lived Supabase JWT for Realtime private channels.
 * Claims mirror what `public.current_tenant_id()` expects: `org_id` =
 * Clerk org id (or `user_<clerkUserId>` for personal tenants).
 */
export function mintRealtimeJwt(claims: {
  sub: string;
  orgId: string;
  expiresInSeconds?: number;
}): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    role: "authenticated",
    iss: "supabase",
    iat: now,
    exp: now + (claims.expiresInSeconds ?? 60 * 60),
    sub: claims.sub,
    org_id: claims.orgId,
  };

  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function canMintRealtimeJwt(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET);
}
