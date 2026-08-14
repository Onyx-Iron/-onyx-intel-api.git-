import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";

const env = loadIntegrationTestEnv();

describe("billing webhook ordering (live database)", { skip: !env.ready && env.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(env.supabaseUrl as string, env.serviceKey as string) as any;
  const mark = `billing_order_${Date.now()}`;
  let tenantId = "";

  before(async () => {
    const { data, error } = await db
      .from("tenants")
      .insert({
        clerk_org_id: mark,
        name: mark,
        plan_tier: "solo",
        subscription_status: "active",
        paddle_customer_id: "ctm_test",
        paddle_subscription_id: "sub_test",
        ai_credits_remaining: 37,
      })
      .select("id")
      .single();
    if (error) throw error;
    tenantId = data.id;
  });

  after(async () => {
    if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  });

  it("rejects older state and does not refill credits on same-plan updates", async () => {
    const newer = await db.rpc("apply_tenant_billing_event", {
      p_tenant_id: tenantId,
      p_event_occurred_at: "2026-08-14T12:00:00.000Z",
      p_patch: { subscription_status: "canceled" },
    });
    assert.equal(newer.error, null, newer.error?.message);
    assert.equal(newer.data, true);

    const older = await db.rpc("apply_tenant_billing_event", {
      p_tenant_id: tenantId,
      p_event_occurred_at: "2026-08-14T11:00:00.000Z",
      p_patch: { subscription_status: "active", ai_credits_remaining: 100 },
    });
    assert.equal(older.error, null, older.error?.message);
    assert.equal(older.data, false);

    const samePlanUpdate = await db.rpc("apply_tenant_billing_event", {
      p_tenant_id: tenantId,
      p_event_occurred_at: "2026-08-14T13:00:00.000Z",
      p_patch: {
        plan_tier: "solo",
        subscription_status: "active",
        ai_credits_remaining: 100,
        ai_credits_reset_at: "2026-09-14T13:00:00.000Z",
      },
    });
    assert.equal(samePlanUpdate.error, null, samePlanUpdate.error?.message);
    assert.equal(samePlanUpdate.data, true);

    const { data: tenant, error } = await db
      .from("tenants")
      .select("subscription_status, ai_credits_remaining, billing_event_occurred_at")
      .eq("id", tenantId)
      .single();
    assert.equal(error, null, error?.message);
    assert.equal(tenant.subscription_status, "active");
    assert.equal(tenant.ai_credits_remaining, 37);
    assert.equal(tenant.billing_event_occurred_at, "2026-08-14T13:00:00+00:00");
  });
});
