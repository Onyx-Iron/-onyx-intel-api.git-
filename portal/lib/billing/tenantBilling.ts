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
  billing_event_occurred_at: string | null;
}

const BILLING_COLS =
  "plan_tier, subscription_status, paddle_customer_id, paddle_subscription_id, seat_limit, seats_used, ai_credits_remaining, ai_credits_reset_at, trial_ends_at, comp_until, billing_event_occurred_at";

export async function getTenantBilling(
  tenantId: string,
): Promise<TenantBilling | null> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(BILLING_COLS)
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as TenantBilling;
}

export async function setTenantBilling(
  tenantId: string,
  patch: Partial<TenantBilling>,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("tenants")
    .update(patch as never)
    .eq("id", tenantId);
  if (error) {
    throw new Error(`setTenantBilling failed: ${error.message}`);
  }
}

export async function setTenantBillingFromEvent(
  tenantId: string,
  occurredAt: string,
  patch: Partial<Omit<TenantBilling, "billing_event_occurred_at">>,
): Promise<boolean> {
  const supabase = await createServiceClient();
  // The RPC is introduced by 20260814101000_order_billing_webhook_state.sql.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("apply_tenant_billing_event", {
    p_tenant_id: tenantId,
    p_event_occurred_at: occurredAt,
    p_patch: patch,
  });
  if (error) {
    throw new Error(`setTenantBillingFromEvent failed: ${error.message}`);
  }
  return data === true;
}

export async function setCompUntil(
  tenantId: string,
  until: Date | null,
): Promise<void> {
  await setTenantBilling(tenantId, {
    comp_until: until ? until.toISOString() : null,
  });
}
