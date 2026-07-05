import { createServiceClient } from "@/lib/supabase/server";
import { getPlan, tierIsAtLeast, type PlanTier } from "./plans";
import { getTenantBilling } from "./tenantBilling";

export { tierIsAtLeast } from "./plans";

type RequirePlanOk = { ok: true; tier: PlanTier };
type RequirePlanErr = {
  ok: false;
  code: "no_plan" | "expired" | "insufficient_tier";
  current: PlanTier;
  required: PlanTier;
};

export async function requirePlan(
  tenantId: string,
  minTier: PlanTier,
): Promise<RequirePlanOk | RequirePlanErr> {
  const billing = await getTenantBilling(tenantId);
  if (!billing) {
    return {
      ok: false,
      code: "no_plan",
      current: "trial",
      required: minTier,
    };
  }

  const now = Date.now();
  const current = billing.plan_tier;

  // Comp tier with a valid future comp_until always passes.
  if (billing.comp_until && new Date(billing.comp_until).getTime() > now) {
    return { ok: true, tier: "comp" };
  }

  // Trial window: if within trial_ends_at, treat as trial-level access.
  const trialActive =
    current === "trial" &&
    billing.trial_ends_at &&
    new Date(billing.trial_ends_at).getTime() > now;

  if (trialActive) {
    if (tierIsAtLeast("trial", minTier)) {
      return { ok: true, tier: "trial" };
    }
    return {
      ok: false,
      code: "insufficient_tier",
      current,
      required: minTier,
    };
  }

  // Trial expired
  if (current === "trial") {
    return { ok: false, code: "expired", current, required: minTier };
  }

  // Paid plan: check subscription_status is healthy.
  const status = billing.subscription_status;
  const healthyStatuses = new Set(["active", "trialing"]);
  if (status && !healthyStatuses.has(status)) {
    // past_due / canceled / incomplete — block unless tier still meets bar AND status allows grace.
    return { ok: false, code: "expired", current, required: minTier };
  }

  if (!tierIsAtLeast(current, minTier)) {
    return {
      ok: false,
      code: "insufficient_tier",
      current,
      required: minTier,
    };
  }

  return { ok: true, tier: current };
}

type RequireCreditsOk = { ok: true; remaining: number };
type RequireCreditsErr = {
  ok: false;
  reason: "no_credits" | "no_plan";
  remaining: number;
};

export async function requireCredits(
  tenantId: string,
  count: number,
): Promise<RequireCreditsOk | RequireCreditsErr> {
  const billing = await getTenantBilling(tenantId);
  if (!billing) {
    return { ok: false, reason: "no_plan", remaining: 0 };
  }

  const now = Date.now();
  // Comp bypass
  if (billing.comp_until && new Date(billing.comp_until).getTime() > now) {
    return { ok: true, remaining: Number.POSITIVE_INFINITY };
  }

  const plan = getPlan(billing.plan_tier);
  // Unlimited credits per plan definition
  if (plan.aiCreditsPerMonth === -1) {
    return { ok: true, remaining: Number.POSITIVE_INFINITY };
  }

  const remaining = billing.ai_credits_remaining ?? 0;
  if (remaining < count) {
    return { ok: false, reason: "no_credits", remaining };
  }
  return { ok: true, remaining };
}

export async function decrementCredits(
  tenantId: string,
  count: number,
): Promise<void> {
  const billing = await getTenantBilling(tenantId);
  if (!billing) return;

  // Bypass: comp or unlimited plan
  const now = Date.now();
  if (billing.comp_until && new Date(billing.comp_until).getTime() > now) {
    return;
  }
  const plan = getPlan(billing.plan_tier);
  if (plan.aiCreditsPerMonth === -1) return;

  const next = Math.max(0, (billing.ai_credits_remaining ?? 0) - count);
  const supabase = await createServiceClient();
  await (supabase.from("tenants") as any)
    .update({ ai_credits_remaining: next })
    .eq("id", tenantId);
}
