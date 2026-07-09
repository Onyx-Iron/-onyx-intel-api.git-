import { createServiceClient } from "@/lib/supabase/server";
import type { PlanTier } from "./plans";

export interface TenantBilling {
  plan_tier: PlanTier;
  subscription_status: string | null;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  seat_limit: number;
  seats_used: number;
  ai_credits_remaining: number;
  ai_credits_reset_at: string | null;
  trial_ends_at: string | null;
  comp_until: string | null;
}

const BILLING_COLS =
  "plan_tier, subscription_status, paddle_customer_id, paddle_subscription_id, seat_limit, seats_used, ai_credits_remaining, ai_credits_reset_at, trial_ends_at, comp_until";

export async function getTenantBilling(
  tenantId: string,
): Promise<TenantBilling | null> {
  const supabase = await createServiceClient();
  // Cast to any: billing columns aren't in generated supabase types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("tenants") as any)
    .select(BILLING_COLS)
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) return null;
  return data as TenantBilling;
}

export async function setTenantBilling(
  tenantId: string,
  patch: Partial<TenantBilling>,
): Promise<void> {
  const supabase = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("tenants") as any)
    .update(patch)
    .eq("id", tenantId);
  if (error) {
    throw new Error(`setTenantBilling failed: ${error.message}`);
  }
}

export async function setCompUntil(
  tenantId: string,
  until: Date | null,
): Promise<void> {
  await setTenantBilling(tenantId, {
    comp_until: until ? until.toISOString() : null,
  });
}
