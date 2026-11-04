import { tierRank, type PlanTier } from "./plans";

const CREDIT_GRANT_STATUSES = new Set(["active", "trialing"]);
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function billingPeriodEnded(periodEndsAt: string | null, nowMs: number): boolean {
  const endsAt = instant(periodEndsAt);
  return endsAt != null && endsAt < nowMs;
}

export interface AiCreditGrantInput {
  status: string;
  periodEndsAt: string | null;
  storedResetAt: string | null;
  previousTier: PlanTier | null;
  nextTier: PlanTier;
  nextCredits: number;
  nowMs: number;
}

/**
 * Monthly AI credits refill on the first paid grant, a new billing-period
 * end, or an upgrade. A later subscription.updated in the same period
 * (card, address, cancel) must not restore credits that were already used.
 */
export function aiCreditGrant(
  input: AiCreditGrantInput,
): { ai_credits_remaining: number; ai_credits_reset_at: string } | null {
  if (!CREDIT_GRANT_STATUSES.has(input.status)) return null;

  const storedMs = instant(input.storedResetAt);
  const periodMs = instant(input.periodEndsAt);
  const firstGrant = storedMs == null;
  const periodChanged = periodMs != null && storedMs != null && periodMs !== storedMs;
  const upgraded = input.previousTier != null && tierRank(input.nextTier) > tierRank(input.previousTier);
  if (!firstGrant && !periodChanged && !upgraded) return null;

  return {
    ai_credits_remaining: input.nextCredits,
    ai_credits_reset_at: input.periodEndsAt ?? new Date(input.nowMs + MONTH_MS).toISOString(),
  };
}

function instant(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
