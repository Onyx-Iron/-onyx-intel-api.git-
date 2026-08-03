// Integration tests for the estimate-sync outbox worker
// (manual-takeoff-productivity milestone, STEP 14) and the optimistic-
// concurrency update RPC (STEP 2) — run against the LIVE Supabase dev
// database. Uses save_manual_takeoff_tx / update_manual_takeoff_tx /
// soft_delete_manual_takeoff_tx directly (same pattern as
// calibration-and-atomic-writes.integration.test.ts) plus
// lib/estimating/outbox-worker.ts's processOutboxBatch, which itself calls
// the real syncTakeoffToEstimate — proving the worker actually drives
// estimate_items into existence / removes them on delete, not just that the
// outbox row's status field changes.

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";
import { processOutboxBatch } from "./outbox-worker";
import { getOrCreateDraftVersion, approveVersion } from "./versioning";
import { buildEstimateImportRows } from "./takeoff-import";

const integrationEnv = loadIntegrationTestEnv();
const SUPABASE_URL = integrationEnv.supabaseUrl;
const SERVICE_KEY = integrationEnv.serviceKey;
const HAS_DB = integrationEnv.ready;

if (!HAS_DB) {
  describe(`outbox worker (integration, SKIPPED - ${integrationEnv.skipReason})`, () => {
    it("skipped", () => { /* no-op */ });
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!) as any;

  const TEST_MARK = `ow_${Date.now()}`;
  let tenantA: string;
  let projectA: string;
  let documentA: string;
  let pageA: string;
  const extraDocumentIds: string[] = [];

  before(async () => {
    const { data: ta } = await db.from("tenants").insert({ clerk_org_id: `${TEST_MARK}_org_a`, name: "Outbox Worker Tenant" }).select("id").single();
    tenantA = ta.id;
    const { data: pa } = await db.from("projects").insert({ tenant_id: tenantA, name: `${TEST_MARK}_project` }).select("id").single();
    projectA = pa.id;
    const { data: doc } = await db.from("documents").insert({ id: crypto.randomUUID(), tenant_id: tenantA, project_id: projectA, file_name: `${TEST_MARK}.pdf` }).select("id").single();
    documentA = doc.id;
    const { data: page } = await db.from("document_pages").insert({ id: crypto.randomUUID(), tenant_id: tenantA, document_id: documentA, page_number: 1, storage_path: `${TEST_MARK}/page-1.pdf` }).select("id").single();
    pageA = page.id;
    // A cost catalog row so syncTakeoffToEstimate actually prices the item.
    await db.from("cost_catalog").insert({ tenant_id: tenantA, csi_code: "03-30-00", description: "Test line item", uom: "LF", unit_cost: 12 });
  });

  after(async () => {
    await db.from("estimate_items").delete().eq("tenant_id", tenantA);
    await db.from("estimate_versions").delete().in("estimate_id", (await db.from("estimates").select("id").eq("tenant_id", tenantA)).data?.map((e: { id: string }) => e.id) ?? []);
    await db.from("estimates").delete().eq("tenant_id", tenantA);
    await db.from("estimate_sync_outbox").delete().eq("tenant_id", tenantA);
    await db.from("manual_takeoff_history").delete().eq("tenant_id", tenantA);
    await db.from("manual_takeoffs").delete().eq("tenant_id", tenantA);
    await db.from("takeoff_item_history").delete().eq("tenant_id", tenantA);
    await db.from("takeoff_items").delete().eq("tenant_id", tenantA);
    await db.from("cost_catalog").delete().eq("tenant_id", tenantA);
    if (documentA) await db.from("document_pages").delete().eq("document_id", documentA);
    if (documentA) await db.from("documents").delete().eq("id", documentA);
    for (const docId of extraDocumentIds) {
      await db.from("document_pages").delete().eq("document_id", docId);
      await db.from("documents").delete().eq("id", docId);
    }
    await db.from("projects").delete().eq("tenant_id", tenantA);
    await db.from("tenants").delete().eq("id", tenantA);
  });

  // Each estimate-sync test below gets its OWN project (via this helper)
  // rather than sharing projectA/pageA — estimate/version lineage
  // (getOrCreateDraftVersion, approveVersion) is scoped per-project, and two
  // tests sharing one project would interact with each other's draft/
  // approved version state (e.g. one test approving "the" draft version
  // while another test still expects it to be a mutable draft). This bit
  // us directly: an earlier version of this file shared one project across
  // all outbox tests and the "APPROVED" reconciliation test intermittently
  // tripped the DB's `prevent_locked_estimate_item_write` trigger because a
  // sibling test's item was still being synced into the same
  // now-approved-by-another-test version.
  async function createProjectContext() {
    const { data: pa } = await db.from("projects").insert({ tenant_id: tenantA, name: `${TEST_MARK}_project_${crypto.randomUUID()}` }).select("id").single();
    const { data: doc } = await db.from("documents").insert({ id: crypto.randomUUID(), tenant_id: tenantA, project_id: pa.id, file_name: `${TEST_MARK}.pdf` }).select("id").single();
    extraDocumentIds.push(doc.id);
    const { data: page } = await db.from("document_pages").insert({ id: crypto.randomUUID(), tenant_id: tenantA, document_id: doc.id, page_number: 1, storage_path: `${TEST_MARK}/page-1.pdf` }).select("id").single();
    return { projectId: pa.id as string, documentId: doc.id as string, pageId: page.id as string };
  }

  // Reproduces syncTakeoffToEstimate's real dedup/import logic against this
  // test's own bare supabase-js client — syncTakeoffToEstimate itself calls
  // createServiceClient(), which depends on next/headers cookies() and
  // cannot run inside a plain `node --test` process (same constraint noted
  // in lib/estimating/takeoff-integrity.integration.test.ts's runRealSync).
  // Passed to processOutboxBatch via its syncFn injection point so this
  // test proves the WORKER's claim/complete/fail orchestration end-to-end
  // against real sync behavior, not a mock.
  async function runRealSync(tenantId: string, projectId: string) {
    const [{ data: takeoff }, { data: existing }] = await Promise.all([
      db.from("takeoff_items").select("id,label,csi_code,division,quantity,unit,type,meta,review_status").eq("tenant_id", tenantId).eq("project_id", projectId),
      db.from("estimate_items").select("source_takeoff_id,source_fingerprint,notes").eq("tenant_id", tenantId).eq("project_id", projectId),
    ]);
    const { versionId } = await getOrCreateDraftVersion(db, tenantId, projectId, "test_worker");
    const { data: catalog } = await db.from("cost_catalog").select("csi_code,uom,unit_cost").eq("tenant_id", tenantId);
    const result = buildEstimateImportRows({
      takeoffItems: takeoff ?? [], existingEstimateItems: existing ?? [],
      costCatalog: catalog ?? [], projectId,
    });
    if (result.rows.length === 0) return result;
    const { error } = await db.from("estimate_items").insert(result.rows.map((r) => ({ ...r, tenant_id: tenantId, estimate_version_id: versionId })));
    if (error) throw error;
    return result;
  }

  async function processBatch() {
    return processOutboxBatch(db, "test-worker", { batchSize: 10, syncFn: runRealSync });
  }

  async function saveTx(clientKey: string, quantity = 10, ctx?: { projectId: string; pageId: string; documentId: string }) {
    const { data, error } = await db.rpc("save_manual_takeoff_tx", {
      p_tenant_id: tenantA, p_project_id: ctx?.projectId ?? projectA, p_page_id: ctx?.pageId ?? pageA, p_document_id: ctx?.documentId ?? documentA,
      p_cost_code: "03-30-00", p_takeoff_type: "length", p_quantity: quantity, p_unit: "LF",
      p_geometry: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], coordinate_space: "page_space" },
      p_client_key: clientKey, p_actor_user_id: "integration_test_user",
      p_calculation_formula_version: "v1", p_is_vision_sourced: false, p_label: "Outbox test item",
    }).single();
    if (error) throw error;
    return data as { manual_takeoff: { id: string; project_id: string }; mirror_takeoff_item_id: string; was_update: boolean };
  }

  describe("Outbox worker — upsert events", () => {
    it("processOutboxBatch claims a pending upsert event, drives syncTakeoffToEstimate, and marks it processed", async () => {
      const created = await saveTx(`${TEST_MARK}-upsert-1`);
      const { data: before } = await db.from("estimate_sync_outbox").select("status").eq("manual_takeoff_id", created.manual_takeoff.id).single();
      assert.equal(before.status, "pending");

      const result = await processBatch();
      assert.ok(result.claimed >= 1);
      assert.ok(result.completed >= 1);

      const { data: after } = await db.from("estimate_sync_outbox").select("status, processed_at").eq("manual_takeoff_id", created.manual_takeoff.id).single();
      assert.equal(after.status, "processed");
      assert.ok(after.processed_at);

      const { data: estimateItems } = await db.from("estimate_items").select("id, unit_cost").eq("source_takeoff_id", created.mirror_takeoff_item_id);
      assert.equal(estimateItems.length, 1, "the mirror's estimate line item must actually have been created by the worker");
      assert.equal(estimateItems[0].unit_cost, 12);
    });

    it("re-processing an already-processed event is a no-op — no duplicate estimate_items", async () => {
      // Distinct quantity from upsert-1's item — buildEstimateImportRows
      // dedups by a content fingerprint (label+csi_code+quantity+unit), so
      // an identical quantity here would collide with upsert-1's already-
      // synced fingerprint and be skipped as a duplicate for that reason,
      // not because of THIS test's own idempotency logic.
      const created = await saveTx(`${TEST_MARK}-upsert-2`, 11);
      await processBatch();
      await processBatch(); // nothing left pending — claims 0
      const { data: estimateItems } = await db.from("estimate_items").select("id").eq("source_takeoff_id", created.mirror_takeoff_item_id);
      assert.equal(estimateItems.length, 1, "syncTakeoffToEstimate's own dedup prevents a duplicate even if re-run");
    });
  });

  describe("Outbox worker — delete reconciliation (STEP 14)", () => {
    it("a soft-deleted takeoff's already-synced estimate_items row is removed when its estimate version is still DRAFT", async () => {
      const ctx = await createProjectContext();
      const created = await saveTx(`${TEST_MARK}-delete-draft-1`, 20, ctx);
      await processBatch(); // syncs into the draft estimate
      const { data: beforeDelete } = await db.from("estimate_items").select("id").eq("source_takeoff_id", created.mirror_takeoff_item_id);
      assert.equal(beforeDelete.length, 1);

      const { error: delErr } = await db.rpc("soft_delete_manual_takeoff_tx", { p_id: created.manual_takeoff.id, p_tenant_id: tenantA, p_actor_user_id: "integration_test_user" });
      if (delErr) throw delErr;

      await processBatch();
      const { data: afterDelete } = await db.from("estimate_items").select("id").eq("source_takeoff_id", created.mirror_takeoff_item_id);
      assert.equal(afterDelete.length, 0, "a draft-version estimate line sourced purely from the deleted measurement must be reconciled away");
    });

    it("a soft-deleted takeoff's estimate_items row is left completely untouched when its version is APPROVED", async () => {
      const ctx = await createProjectContext();
      const created = await saveTx(`${TEST_MARK}-delete-approved-1`, 30, ctx);
      await processBatch();
      const { data: linked } = await db.from("estimate_items").select("id, estimate_version_id").eq("source_takeoff_id", created.mirror_takeoff_item_id).single();

      const { estimateId } = await getOrCreateDraftVersion(db, tenantA, ctx.projectId, "integration_test_user");
      await approveVersion(db, { versionId: linked.estimate_version_id, estimateId, userId: "integration_test_approver" });

      // Deleting a takeoff whose mirror is already priced into a LOCKED
      // estimate version must succeed (not fail outright) — the mirror is
      // retained rather than hard-deleted specifically because
      // estimate_items.source_takeoff_id's ON DELETE SET NULL cascade would
      // otherwise mutate the locked version's row (see
      // 20260811_soft_delete_locked_estimate_fix.sql).
      const { error: delErr } = await db.rpc("soft_delete_manual_takeoff_tx", { p_id: created.manual_takeoff.id, p_tenant_id: tenantA, p_actor_user_id: "integration_test_user" });
      if (delErr) throw delErr;
      await processBatch();

      const { data: stillThere } = await db.from("estimate_items").select("id").eq("id", linked.id).maybeSingle();
      assert.ok(stillThere, "an approved version's estimate_items row must survive its source measurement being deleted — immutability");

      const { data: mirrorStillExists } = await db.from("takeoff_items").select("id").eq("id", created.mirror_takeoff_item_id).maybeSingle();
      assert.ok(mirrorStillExists, "the mirror itself must be retained (not hard-deleted) precisely because a locked version still references it");
    });
  });

  describe("Optimistic concurrency (update_manual_takeoff_tx)", () => {
    it("editing with the correct row_version succeeds and increments it; editing with a stale row_version returns a structured conflict, not a silent overwrite", async () => {
      const created = await saveTx(`${TEST_MARK}-concurrency-1`, 5);
      const { data: initial } = await db.from("manual_takeoffs").select("row_version").eq("id", created.manual_takeoff.id).single();
      assert.equal(initial.row_version, 1);

      const { data: ok } = await db.rpc("update_manual_takeoff_tx", {
        p_id: created.manual_takeoff.id, p_tenant_id: tenantA, p_expected_row_version: 1,
        p_geometry: { points: [{ x: 0, y: 0 }, { x: 15, y: 0 }], coordinate_space: "page_space" },
        p_quantity: 15, p_unit: "LF", p_cost_code: "03-30-00", p_actor_user_id: "integration_test_user", p_calculation_formula_version: "v1",
      }).single();
      assert.equal(ok.conflict, false);
      assert.equal(ok.manual_takeoff.row_version, 2);

      const { data: stale } = await db.rpc("update_manual_takeoff_tx", {
        p_id: created.manual_takeoff.id, p_tenant_id: tenantA, p_expected_row_version: 1, // stale — real version is now 2
        p_geometry: { points: [{ x: 0, y: 0 }, { x: 999, y: 0 }], coordinate_space: "page_space" },
        p_quantity: 999, p_unit: "LF", p_cost_code: "03-30-00", p_actor_user_id: "integration_test_user", p_calculation_formula_version: "v1",
      }).single();
      assert.equal(stale.conflict, true);
      assert.equal(stale.manual_takeoff.row_version, 2, "conflict response returns the CURRENT authoritative row, not the stale one");
      assert.equal(stale.manual_takeoff.quantity, 15, "the stale attempt's quantity (999) must never have been applied");

      const { data: reread } = await db.from("manual_takeoffs").select("quantity, row_version").eq("id", created.manual_takeoff.id).single();
      assert.equal(reread.quantity, 15);
      assert.equal(reread.row_version, 2);
    });

    it("update history entries alternate created -> updated, never a second 'created'", async () => {
      const created = await saveTx(`${TEST_MARK}-concurrency-2`, 1);
      await db.rpc("update_manual_takeoff_tx", {
        p_id: created.manual_takeoff.id, p_tenant_id: tenantA, p_expected_row_version: 1,
        p_geometry: { points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], coordinate_space: "page_space" },
        p_quantity: 2, p_unit: "LF", p_cost_code: "03-30-00", p_actor_user_id: "integration_test_user", p_calculation_formula_version: "v1",
      });
      const { data: history } = await db.from("manual_takeoff_history").select("action").eq("manual_takeoff_id", created.manual_takeoff.id).order("created_at", { ascending: true });
      assert.deepEqual(history.map((h: { action: string }) => h.action), ["created", "updated"]);
    });
  });
}
