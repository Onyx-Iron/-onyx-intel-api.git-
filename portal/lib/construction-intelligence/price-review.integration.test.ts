import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";
import { buildPriceReviewPreview } from "./price-review";

const env = loadIntegrationTestEnv();

describe("price evidence review confirmation (live database)", { skip: !env.ready && env.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(env.supabaseUrl as string, env.serviceKey as string) as any;
  const mark = `price_review_${Date.now()}`;
  let tenantId = ""; let observationId = ""; let otherObservationId = ""; let previewId = ""; let previewHash = "";

  before(async () => {
    const { data: tenant, error: tenantError } = await db.from("tenants").insert({ clerk_org_id: mark, name: mark }).select("id").single();
    if (tenantError) throw tenantError; tenantId = tenant.id;
    const base = { tenant_id: tenantId, description: mark, source_kind: "company_actual", source_ref: "invoice-100", effective_date: "2026-08-01", unit: "EA", material_cost: 25, confidence: 0.95 };
    const { data: rows, error } = await db.from("price_observations").insert([base, { ...base, source_ref: "invoice-101" }]).select("*");
    if (error) throw error; observationId = rows[0].id; otherObservationId = rows[1].id;
    const preview = buildPriceReviewPreview(rows[0], "approved", "Invoice checked against job cost");
    previewHash = preview.payloadHash;
    const { data: stored, error: previewError } = await db.from("price_observation_review_previews").insert({
      tenant_id: tenantId, price_observation_id: observationId, actor_user_id: "reviewer",
      decision: "approved", reason: "Invoice checked against job cost", payload: preview.payload,
      payload_hash: previewHash, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select("id").single();
    if (previewError) throw previewError; previewId = stored.id;
  });

  after(async () => { if (tenantId) await db.from("tenants").delete().eq("id", tenantId); });

  it("binds the exact target, records the decision once, and blocks replay", async () => {
    const mismatch = await db.rpc("confirm_price_observation_review", {
      p_preview_id: previewId, p_observation_id: otherObservationId, p_tenant_id: tenantId,
      p_actor_user_id: "reviewer", p_payload_hash: previewHash,
    });
    assert.ok(mismatch.error, "a preview must not approve another observation");
    const { data: stillUnreviewed } = await db.from("price_observations").select("approval_status").eq("id", observationId).single();
    assert.equal(stillUnreviewed.approval_status, "unreviewed");

    const confirmed = await db.rpc("confirm_price_observation_review", {
      p_preview_id: previewId, p_observation_id: observationId, p_tenant_id: tenantId,
      p_actor_user_id: "reviewer", p_payload_hash: previewHash,
    });
    assert.equal(confirmed.error, null, confirmed.error?.message);
    assert.equal(confirmed.data.approval_status, "approved");
    const replay = await db.rpc("confirm_price_observation_review", {
      p_preview_id: previewId, p_observation_id: observationId, p_tenant_id: tenantId,
      p_actor_user_id: "reviewer", p_payload_hash: previewHash,
    });
    assert.ok(replay.error, "the same review preview must not execute twice");
    const { count } = await db.from("price_observation_reviews").select("id", { count: "exact", head: true }).eq("price_observation_id", observationId);
    assert.equal(count, 1);
  });
});
