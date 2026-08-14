import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";

import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";

const env = loadIntegrationTestEnv();

describe("atomic estimate version save (live database)", { skip: !env.ready && env.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(env.supabaseUrl as string, env.serviceKey as string) as any;
  const mark = `estimate_save_${Date.now()}`;
  let tenantId = ""; let projectId = ""; let estimateId = ""; let versionId = "";
  let firstId = ""; let secondId = ""; let observationId = "";

  before(async () => {
    const { data: tenant, error: tenantError } = await db.from("tenants").insert({ clerk_org_id: mark, name: mark }).select("id").single();
    if (tenantError) throw tenantError; tenantId = tenant.id;
    const { data: project, error: projectError } = await db.from("projects").insert({ tenant_id: tenantId, name: mark }).select("id").single();
    if (projectError) throw projectError; projectId = project.id;
    const { data: estimate, error: estimateError } = await db.from("estimates").insert({ tenant_id: tenantId, project_id: projectId, estimate_number: mark, name: mark }).select("id").single();
    if (estimateError) throw estimateError; estimateId = estimate.id;
    const { data: version, error: versionError } = await db.from("estimate_versions").insert({
      estimate_id: estimateId, version_number: 1, status: "draft", created_by: "editor",
      contingency_pct: 5, overhead_pct: 10, profit_pct: 15,
    }).select("id").single();
    if (versionError) throw versionError; versionId = version.id;
    await db.from("estimates").update({ current_version_id: versionId }).eq("id", estimateId);
    const { data: price, error: priceError } = await db.from("price_observations").insert({
      tenant_id: tenantId, project_id: projectId, description: mark, source_kind: "project_quote",
      source_ref: "quote-atomic", effective_date: "2026-08-01", unit: "EA", material_cost: 10,
      confidence: 1, approval_status: "approved", approved_by: "reviewer", approved_at: new Date().toISOString(),
    }).select("id").single();
    if (priceError) throw priceError; observationId = price.id;
    const { data: items, error: itemError } = await db.from("estimate_items").insert([1, 2].map((n) => ({
      tenant_id: tenantId, project_id: projectId, estimate_version_id: versionId,
      description: `Item ${n}`, quantity: 1, uom: "EA", material_cost: 10,
      total_direct_cost: 10, total_price: 10, unit_price: 10, pricing_status: "priced",
      price_observation_id: observationId, price_source_snapshot: { id: observationId },
      pricing_effective_date: "2026-08-01", pricing_confidence: 1,
    }))).select("id");
    if (itemError) throw itemError; [firstId, secondId] = items.map((row: { id: string }) => row.id);
  });

  after(async () => {
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    if (projectId) await db.from("projects").delete().eq("id", projectId);
    if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  });

  const payload = (id: string, expected: number, quantity: number) => ({
    id, expected_row_version: expected, tenant_id: tenantId, project_id: projectId,
    estimate_version_id: versionId, cost_code: "01-00-00", description: "Updated item",
    scope_category: null, quantity, uom: "EA", labor_cost: 0, material_cost: quantity * 10,
    equipment_cost: 0, trucking_cost: 0, subcontract_cost: 0, disposal_cost: 0,
    testing_cost: 0, other_direct_cost: 0, total_direct_cost: quantity * 10, indirect_cost: 0,
    contingency: 0, overhead: 0, profit: 0, total_price: quantity * 10, unit_price: 10,
    notes: null, assumptions: null, exclusions: null, is_allowance: false, is_alternate: false,
    alternate_accepted: false, sort_order: 0, clear_price_evidence: true, created_by: "editor", updated_by: "editor",
  });

  it("rolls back every row and setting when any item revision is stale", async () => {
    const { data: version } = await db.from("estimate_versions").select("row_version").eq("id", versionId).single();
    const result = await db.rpc("save_estimate_version", {
      p_version_id: versionId, p_tenant_id: tenantId, p_actor_user_id: "editor",
      p_expected_version_revision: version.row_version, p_settings: { profit_pct: 22 },
      p_items: [payload(firstId, 0, 2), payload(secondId, 999, 3)],
    });
    assert.ok(result.error, "stale batch must fail");
    const { data: first } = await db.from("estimate_items").select("quantity").eq("id", firstId).single();
    const { data: unchangedVersion } = await db.from("estimate_versions").select("profit_pct").eq("id", versionId).single();
    assert.equal(Number(first.quantity), 1);
    assert.equal(Number(unchangedVersion.profit_pct), 15);
  });

  it("commits an exact row and removes stale pricing evidence", async () => {
    const { data: version } = await db.from("estimate_versions").select("row_version").eq("id", versionId).single();
    const result = await db.rpc("save_estimate_version", {
      p_version_id: versionId, p_tenant_id: tenantId, p_actor_user_id: "editor",
      p_expected_version_revision: version.row_version, p_settings: {}, p_items: [payload(firstId, 0, 2)],
    });
    assert.equal(result.error, null, result.error?.message);
    const { data: first } = await db.from("estimate_items")
      .select("quantity,row_version,pricing_status,price_observation_id,price_source_snapshot")
      .eq("id", firstId).single();
    assert.equal(Number(first.quantity), 2);
    assert.equal(first.row_version, 1);
    assert.equal(first.pricing_status, "manual");
    assert.equal(first.price_observation_id, null);
    assert.equal(first.price_source_snapshot, null);
  });
});
