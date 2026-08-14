import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";

const env = loadIntegrationTestEnv();

describe("AI credit consumption (live database)", { skip: !env.ready && env.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(env.supabaseUrl as string, env.serviceKey as string) as any;
  const mark = `ai_credits_${Date.now()}`;
  let tenantId = "";

  before(async () => {
    const { data, error } = await db
      .from("tenants")
      .insert({
        clerk_org_id: mark,
        name: mark,
        plan_tier: "solo",
        subscription_status: "active",
        ai_credits_remaining: 1,
        ai_credits_reset_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    tenantId = data.id;
  });

  after(async () => {
    if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  });

  it("allows only one of two concurrent requests to spend the final credit", async () => {
    const calls = await Promise.all([
      db.rpc("consume_ai_credits", { p_tenant_id: tenantId, p_count: 1 }),
      db.rpc("consume_ai_credits", { p_tenant_id: tenantId, p_count: 1 }),
    ]);

    for (const call of calls) assert.equal(call.error, null, call.error?.message);
    const outcomes = calls.map((call) => call.data.allowed).sort();
    assert.deepEqual(outcomes, [false, true]);
    assert.ok(calls.some((call) => call.data.reason === "no_credits"));

    const { data: tenant, error } = await db
      .from("tenants")
      .select("ai_credits_remaining")
      .eq("id", tenantId)
      .single();
    assert.equal(error, null, error?.message);
    assert.equal(tenant.ai_credits_remaining, 0);
  });
});
