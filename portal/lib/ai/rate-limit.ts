import { createServiceClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/python-api";

/**
 * Per-tenant rate limit for routes that trigger a paid LLM API call. Backed
 * by a Postgres table (not in-memory) because Vercel serverless functions
 * are stateless across invocations/instances — an in-memory counter would
 * reset per cold start and wouldn't be shared across concurrent instances.
 *
 * This is a coarse abuse guard, not a precision limiter: it counts rows
 * inserted in the trailing window rather than using a fixed bucket, so it's
 * a true sliding window at the cost of one extra round-trip per call.
 *
 * The admin account (justinatteberry@onyx-iron.com) bypasses this entirely,
 * consistent with the same bypass already applied to the Railway takeoff
 * service (see lib/python-api.ts's isAdminEmail/pythonApiSecret) and to
 * billing/plan limits (tenants.comp_until — see lib/billing/gate.ts).
 */
export async function checkAiRateLimit(
  tenantId: string,
  route: string,
  { windowMs, max }: { windowMs: number; max: number },
  email?: string | null,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  if (isAdminEmail(email)) return { ok: true };

  const db = await createServiceClient();
  const windowStart = new Date(Date.now() - windowMs).toISOString();

  // `ai_rate_limit_hits` is not yet in the generated Supabase types (same
  // situation as other brand-new tables like `daily_logs`/`cut_fill_surfaces`
  // elsewhere in this repo) — cast the table name until types are regenerated.
  const { count, error } = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("ai_rate_limit_hits" as any)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("route", route)
    .gte("created_at", windowStart);

  // Fail open on a DB error — a rate-limit outage should not take down the
  // feature itself, and Supabase is already a hard dependency for everything
  // else these routes do.
  if (error) return { ok: true };

  if ((count ?? 0) >= max) {
    return { ok: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.from("ai_rate_limit_hits" as any).insert({ tenant_id: tenantId, route });
  return { ok: true };
}
