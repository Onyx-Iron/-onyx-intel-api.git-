import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadIntegrationTestEnv } from "@/lib/test-utils/integration-guard";
import { hashApprovalPayload } from "./approval-preview";
import { advanceTakeoffPageJob, createGovernedPageContext, releaseRejectedCandidateBlock } from "./governance-server";

const integrationEnv = loadIntegrationTestEnv();

describe("governed vision candidates (live database)", { skip: !integrationEnv.ready && integrationEnv.skipReason }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(integrationEnv.supabaseUrl as string, integrationEnv.serviceKey as string) as any;
  const mark = `governed_vision_${Date.now()}`;
  let tenantId: string;
  let projectId: string;
  let documentId: string;
  let pageId: string;
  let jobId: string;
  let manifestId: string;

  before(async () => {
    const tenant = await db.from("tenants").insert({ clerk_org_id: `${mark}_org`, name: mark }).select("id").single();
    if (tenant.error) throw tenant.error;
    tenantId = tenant.data.id;
    const project = await db.from("projects").insert({ tenant_id: tenantId, name: mark }).select("id").single();
    if (project.error) throw project.error;
    projectId = project.data.id;
    documentId = crypto.randomUUID();
    pageId = crypto.randomUUID();
    const document = await db.from("documents").insert({ id: documentId, tenant_id: tenantId, project_id: projectId, file_name: `${mark}.pdf` });
    if (document.error) throw document.error;
    const page = await db.from("document_pages").insert({ id: pageId, tenant_id: tenantId, document_id: documentId, page_number: 1, storage_path: `${mark}/1.pdf` });
    if (page.error) throw page.error;
    const scope = await db.from("takeoff_scope_requests").insert({
      tenant_id: tenantId, project_id: projectId, requested_by: "estimator-1", mode: "all_scopes",
      division_codes: [], trade_keys: [], bid_package_ids: [], document_ids: [], sheet_ids: [], alternate_keys: [],
      estimated_work_units: 1, status: "confirmed", confirmed_at: new Date().toISOString(),
    });
    if (scope.error) throw scope.error;
    const job = await db.from("takeoff_jobs").insert({ tenant_id: tenantId, project_id: projectId, scope_snapshot: { mode: "complete" }, scope_hash: mark, created_by: "estimator-1" }).select("id").single();
    if (job.error) throw job.error;
    jobId = job.data.id;
    const manifest = await db.from("takeoff_source_manifests").insert({
      tenant_id: tenantId, project_id: projectId, document_id: documentId, sheet_identity: "A:A101",
      discipline: "A", sheet_number: "A101", source_checksum: "checksum-1", manifest_version: 1,
      authority_status: "authoritative", created_by: "estimator-1",
    }).select("id").single();
    if (manifest.error) throw manifest.error;
    manifestId = manifest.data.id;
  });

  after(async () => {
    if (tenantId) await db.from("takeoff_item_history").delete().eq("tenant_id", tenantId);
    if (tenantId) await db.from("takeoff_items").delete().eq("tenant_id", tenantId);
    if (jobId) await db.from("takeoff_job_events").delete().eq("job_id", jobId);
    if (jobId) await db.from("takeoff_job_units").delete().eq("job_id", jobId);
    if (manifestId) await db.from("takeoff_source_manifests").delete().eq("id", manifestId);
    if (jobId) await db.from("takeoff_jobs").delete().eq("id", jobId);
    if (documentId) await db.from("document_pages").delete().eq("document_id", documentId);
    if (documentId) await db.from("documents").delete().eq("id", documentId);
    if (projectId) await db.from("projects").delete().eq("id", projectId);
    if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  });

  it("atomically attaches job, authoritative revision, quoted source, and calculation evidence", async () => {
    const calculationChecksum = "calculation-1";
    const { error } = await db.rpc("apply_vision_extraction_takeoff_items", {
      p_tenant_id: tenantId,
      p_project_id: projectId,
      p_document_id: documentId,
      p_page_id: pageId,
      p_page_number: 1,
      p_job_id: jobId,
      p_source_manifest_id: manifestId,
      p_source_manifest_version: 1,
      p_source_checksum: "checksum-1",
      p_items: [{
        description: `${mark} doors`, quantity: 12, unit: "EA", cost_code: "08-10-00", source: "schedule",
        confidence: 0.99, raw_text: "TYPE A DOORS QTY 12", measurement_basis: "source_text",
        validation_status: "validated", validation_reason: null, formula_version: "source-text-v1",
        calculation_checksum: calculationChecksum,
      }],
    });
    assert.equal(error, null, error?.message);

    const row = await db.from("takeoff_items")
      .select("takeoff_job_id,source_manifest_id,source_manifest_version,source_checksum,quantity_validation_status,formula_version,calculation_checksum,source_provenance")
      .eq("tenant_id", tenantId).eq("document_id", documentId).single();
    assert.equal(row.error, null, row.error?.message);
    assert.equal(row.data.takeoff_job_id, jobId);
    assert.equal(row.data.source_manifest_id, manifestId);
    assert.equal(row.data.source_manifest_version, 1);
    assert.equal(row.data.source_checksum, "checksum-1");
    assert.equal(row.data.quantity_validation_status, "validated");
    assert.equal(row.data.formula_version, "source-text-v1");
    assert.equal(row.data.calculation_checksum, calculationChecksum);
    assert.equal(row.data.source_provenance.raw_text, "TYPE A DOORS QTY 12");
  });

  it("creates a page-scoped job from confirmed preflight and advances it only through legal transitions", async () => {
    const context = await createGovernedPageContext({
      db, tenantId, projectId, documentId, pageId, pageNumber: 1,
      sourceChecksum: "helper-checksum", actorUserId: "estimator-1",
    });
    assert.ok(context.jobId);
    assert.ok(context.manifestId);
    assert.equal(context.manifestVersion, 1);
    await advanceTakeoffPageJob(db, tenantId, context.jobId, context.unitId, "estimator-1", false);
    const [job, unit, events] = await Promise.all([
      db.from("takeoff_jobs").select("state,row_version").eq("id", context.jobId).single(),
      db.from("takeoff_job_units").select("state,row_version").eq("id", context.unitId).single(),
      db.from("takeoff_job_events").select("id", { count: "exact", head: true }).eq("job_id", context.jobId),
    ]);
    assert.deepEqual(job.data, { state: "blocked", row_version: 5 });
    assert.deepEqual(unit.data, { state: "blocked", row_version: 5 });
    assert.equal(events.count, 10);
    assert.equal(await releaseRejectedCandidateBlock(db, tenantId, projectId, context.jobId, "estimator-1"), true);
    const released = await db.from("takeoff_jobs").select("state,row_version").eq("id", context.jobId).single();
    assert.deepEqual(released.data, { state: "review_ready", row_version: 7 });
  });

  it("refuses confirmation when a candidate lacks validated quantity evidence", async () => {
    const ready = await db.from("takeoff_jobs").update({ state: "review_ready" }).eq("id", jobId);
    if (ready.error) throw ready.error;
    const candidate = await db.from("takeoff_items").insert({
      tenant_id: tenantId, project_id: projectId, label: `${mark} blocked`, quantity: 9, unit: "EA",
      type: "takeoff_import", page: 1, document_id: documentId, sheet_id: pageId,
      review_status: "suggested", source_method: "ai_vision", takeoff_job_id: jobId,
      source_manifest_id: manifestId, source_manifest_version: 1, source_checksum: "checksum-1",
      quantity_validation_status: "blocked", quantity_validation_reason: "quantity_not_quoted",
    }).select("id,row_version").single();
    if (candidate.error) throw candidate.error;
    const membership = await db.from("project_memberships").insert({
      tenant_id: tenantId, project_id: projectId, clerk_user_id: "estimator-1",
      project_role: "estimator", granted_by: "estimator-1",
    });
    if (membership.error) throw membership.error;
    const payload = {
      jobId, projectId,
      candidateVersions: [{
        id: candidate.data.id, version: candidate.data.row_version, sourceManifestVersion: 1,
        sourceChecksum: "checksum-1", quantity: 9, unit: "EA",
      }],
    };
    const payloadHash = hashApprovalPayload(payload);
    const preview = await db.from("takeoff_approval_previews").insert({
      tenant_id: tenantId, project_id: projectId, job_id: jobId, actor_user_id: "estimator-1",
      payload, payload_hash: payloadHash, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select("id").single();
    if (preview.error) throw preview.error;
    const confirmation = await db.rpc("confirm_takeoff_approval_preview", {
      p_tenant_id: tenantId, p_preview_id: preview.data.id, p_actor_user_id: "estimator-1", p_payload_hash: payloadHash,
    });
    assert.ok(confirmation.error);
    assert.match(confirmation.error.message, /validated authoritative evidence/i);
    const unchanged = await db.from("takeoff_items").select("review_status").eq("id", candidate.data.id).single();
    assert.equal(unchanged.data.review_status, "suggested");
  });

  it("confirms the exact validated candidate version and increments its row version", async () => {
    const candidate = await db.from("takeoff_items").select("id,row_version,quantity,unit")
      .eq("tenant_id", tenantId).eq("label", `${mark} doors`).single();
    if (candidate.error) throw candidate.error;
    const payload = {
      jobId, projectId,
      candidateVersions: [{
        id: candidate.data.id, version: candidate.data.row_version, sourceManifestVersion: 1,
        sourceChecksum: "checksum-1", quantity: candidate.data.quantity, unit: candidate.data.unit,
      }],
    };
    const payloadHash = hashApprovalPayload(payload);
    const preview = await db.from("takeoff_approval_previews").insert({
      tenant_id: tenantId, project_id: projectId, job_id: jobId, actor_user_id: "estimator-1",
      payload, payload_hash: payloadHash, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select("id").single();
    if (preview.error) throw preview.error;
    const confirmation = await db.rpc("confirm_takeoff_approval_preview", {
      p_tenant_id: tenantId, p_preview_id: preview.data.id, p_actor_user_id: "estimator-1", p_payload_hash: payloadHash,
    });
    assert.equal(confirmation.error, null, confirmation.error?.message);
    assert.equal(confirmation.data.approved_count, 1);
    const approved = await db.from("takeoff_items").select("review_status,row_version,approved_by")
      .eq("id", candidate.data.id).single();
    assert.deepEqual(approved.data, { review_status: "approved", row_version: candidate.data.row_version + 1, approved_by: "estimator-1" });
  });
});
