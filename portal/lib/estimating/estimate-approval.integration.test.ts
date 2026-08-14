import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";

import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";
import { buildEstimateApprovalPayload } from "./estimate-approval";

const env = loadIntegrationTestEnv();

describe("estimate approval preview (live database)", { skip: !env.ready && env.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(env.supabaseUrl as string, env.serviceKey as string) as any;
  const mark = `estimate_approval_${Date.now()}`;
  let tenantId = ""; let projectId = ""; let estimateId = ""; let versionId = "";

  before(async () => {
    const { data: tenant, error: tenantError } = await db.from("tenants").insert({ clerk_org_id: mark, name: mark }).select("id").single();
    if (tenantError) throw tenantError; tenantId = tenant.id;
    const { data: project, error: projectError } = await db.from("projects").insert({ tenant_id: tenantId, name: mark }).select("id").single();
    if (projectError) throw projectError; projectId = project.id;
    const { data: estimate, error: estimateError } = await db.from("estimates").insert({ tenant_id: tenantId, project_id: projectId, estimate_number: mark, name: mark }).select("id").single();
    if (estimateError) throw estimateError; estimateId = estimate.id;
    const { data: version, error: versionError } = await db.from("estimate_versions").insert({
      estimate_id: estimateId, version_number: 1, status: "draft", created_by: "approver",
      contingency_pct: 5, overhead_pct: 10, profit_pct: 15,
    }).select("id").single();
    if (versionError) throw versionError; versionId = version.id;
    await db.from("estimates").update({ current_version_id: versionId }).eq("id", estimateId);
    const { data: price, error: priceError } = await db.from("price_observations").insert({
      tenant_id: tenantId, project_id: projectId, description: mark, source_kind: "project_quote",
      source_ref: "quote-1", effective_date: "2026-08-01", unit: "SF", material_cost: 9,
      confidence: 1, approval_status: "approved", approved_by: "reviewer", approved_at: new Date().toISOString(),
    }).select("*").single();
    if (priceError) throw priceError;
    const { error: itemError } = await db.from("estimate_items").insert({
      tenant_id: tenantId, project_id: projectId, estimate_version_id: versionId,
      description: "Concrete slab", csi_code: "03-30-00", quantity: 100, uom: "SF",
      source_fingerprint: `${mark}|source`, quantity_basis: "Measured area", drawing_ref: "S-101",
      material_cost: 900, total_direct_cost: 900, contingency: 45, overhead: 94.5,
      profit: 155.93, total_price: 1195.43, unit_price: 11.9543, pricing_status: "priced",
      price_observation_id: price.id, price_source_snapshot: price,
      pricing_effective_date: price.effective_date, pricing_confidence: price.confidence,
    });
    if (itemError) throw itemError;
  });

  after(async () => {
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    if (projectId) await db.from("projects").delete().eq("id", projectId);
    if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  });

  it("confirms the exact revision once and leaves the approved version immutable", async () => {
    const { data: version, error: versionReadError } = await db.from("estimate_versions").select("*").eq("id", versionId).single();
    if (versionReadError) throw versionReadError;
    const flattened = { ...version, tenant_id: tenantId, project_id: projectId };
    const { data: items } = await db.from("estimate_items").select("*").eq("estimate_version_id", versionId);
    const payload = buildEstimateApprovalPayload(flattened, items);
    assert.equal(payload.quality.ready_for_proposal, true);
    const payloadHash = hashApprovalPayload(payload);
    const { data: preview, error: previewError } = await db.from("estimate_approval_previews").insert({
      tenant_id: tenantId, project_id: projectId, estimate_id: estimateId, estimate_version_id: versionId,
      actor_user_id: "approver", payload, payload_hash: payloadHash, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select("id").single();
    if (previewError) throw previewError;
    const first = await db.rpc("confirm_estimate_approval", {
      p_preview_id: preview.id, p_tenant_id: tenantId, p_actor_user_id: "approver", p_payload_hash: payloadHash,
    });
    assert.equal(first.error, null, first.error?.message);
    assert.equal(first.data.status, "approved");
    const repeated = await db.rpc("confirm_estimate_approval", {
      p_preview_id: preview.id, p_tenant_id: tenantId, p_actor_user_id: "approver", p_payload_hash: payloadHash,
    });
    assert.ok(repeated.error, "the same approval preview must not execute twice");
    const mutation = await db.from("estimate_items").update({ quantity: 101 }).eq("estimate_version_id", versionId);
    assert.ok(mutation.error, "approved estimate items must remain immutable");
  });
});
