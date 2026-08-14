import { createServiceClient } from "@/lib/supabase/server";

/**
 * Per-tenant rate limit for routes that trigger a paid LLM API call. Backed
 * by a Postgres table (not in-memory) because Vercel serverless functions
 * are stateless across invocations/instances — an in-memory counter would
 * reset per cold start and wouldn't be shared across concurrent instances.
 *
 * The database function takes a transaction-scoped advisory lock before it
 * counts and inserts, so concurrent serverless requests cannot all slip past
 * the ceiling. Provider-spend protection applies to every account, including
 * administrators.
 */
export async function checkAiRateLimit(
  tenantId: string,
  route: string,
  { windowMs, max }: { windowMs: number; max: number },
  email?: string | null,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  void email;

  const db = await createServiceClient();
  // The RPC is introduced by 20260814_atomic_ai_rate_limits.sql. Cast until
  // generated database types are refreshed after production migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).rpc("consume_ai_rate_limit", {
    p_tenant_id: tenantId,
    p_route: route,
    p_window_ms: windowMs,
    p_max_hits: max,
  });

  // Fail closed when the spend guard is unavailable. A temporary 429 is safer
  // than allowing an unbounded number of paid provider calls during a DB fault.
  if (error || data !== true) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
  }
  return { ok: true };
}
