import { createServiceClient } from "@/lib/supabase/server";

type AiCreditReason = "no_credits" | "no_plan" | "inactive" | "unavailable";
type AiCreditDecision =
  | { ok: true; remaining: number }
  | { ok: false; reason: AiCreditReason; remaining: number; resetAt?: string };

type RawAiCreditResult = {
  allowed?: unknown;
  reason?: unknown;
  remaining?: unknown;
  reset_at?: unknown;
};

export function interpretAiCreditResult(
  data: unknown,
  error: { message?: string } | null,
): AiCreditDecision {
  if (error || !data || typeof data !== "object") {
    return { ok: false, reason: "unavailable", remaining: 0 };
  }

  const raw = data as RawAiCreditResult;
  const remaining =
    typeof raw.remaining === "number" && Number.isFinite(raw.remaining)
      ? raw.remaining
      : 0;
  if (raw.allowed === true) return { ok: true, remaining };

  const reason: AiCreditReason =
    raw.reason === "no_credits" || raw.reason === "no_plan" || raw.reason === "inactive"
      ? raw.reason
      : "unavailable";
  return {
    ok: false,
    reason,
    remaining,
    ...(typeof raw.reset_at === "string" ? { resetAt: raw.reset_at } : {}),
  };
}

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
): Promise<
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number; reason: "rate_limit" | AiCreditReason; remaining?: number }
> {
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
    return {
      ok: false,
      reason: "rate_limit",
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }

  // A generation allowance is a plan entitlement, distinct from the short
  // burst limit above. The database row lock makes the final credit safe
  // under concurrent Vercel invocations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const credit = await (db as any).rpc("consume_ai_credits", {
    p_tenant_id: tenantId,
    p_count: 1,
  });
  const decision = interpretAiCreditResult(credit.data, credit.error);
  if (decision.ok) return decision;

  const resetMs = decision.resetAt ? new Date(decision.resetAt).getTime() : Number.NaN;
  const retryAfterSeconds = Number.isFinite(resetMs)
    ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))
    : Math.max(1, Math.ceil(windowMs / 1000));
  return { ...decision, retryAfterSeconds };
}
