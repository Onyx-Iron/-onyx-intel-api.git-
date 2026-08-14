import { createHash } from "node:crypto";
import { buildVisionSourceDescriptor, scopeRequestToJobScope } from "./vision-governance";

// Supabase's generated type file can lag an unapplied migration in local
// development. This boundary is intentionally structural and kept server-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GovernanceDb = any;

export interface GovernedPageContext {
  jobId: string;
  unitId: string;
  manifestId: string;
  manifestVersion: number;
  authoritativeManifestVersion: number;
  authoritativeChecksum: string;
}

export async function createGovernedPageContext(args: {
  db: GovernanceDb;
  tenantId: string;
  projectId: string;
  documentId: string;
  pageId: string;
  pageNumber: number;
  sourceChecksum: string;
  actorUserId: string;
}): Promise<GovernedPageContext> {
  const { db, tenantId, projectId, documentId, pageId, pageNumber, sourceChecksum, actorUserId } = args;
  const { data: scopeRequest, error: scopeError } = await db.from("takeoff_scope_requests")
    .select("mode,division_codes,trade_keys,bid_package_ids,document_ids,sheet_ids,alternate_keys,confirmed_at,requested_by")
    .eq("tenant_id", tenantId).eq("project_id", projectId).eq("status", "confirmed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (scopeError) throw new Error(scopeError.message);
  if (!scopeRequest) throw new Error("Confirm the takeoff processing scope before automated extraction");

  const { data: sheet } = await db.from("sheets")
    .select("id,discipline,sheet_number_normalized,sheet_number_raw,revision,revision_date")
    .eq("tenant_id", tenantId).eq("project_id", projectId).eq("document_page_id", pageId)
    .eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const source = buildVisionSourceDescriptor({
    documentId, pageId, pageNumber, checksum: sourceChecksum,
    sheet: sheet ? {
      discipline: sheet.discipline,
      sheetNumber: sheet.sheet_number_normalized ?? sheet.sheet_number_raw,
      revision: sheet.revision,
      revisionDate: sheet.revision_date,
    } : null,
  });

  const { data: authoritative } = await db.from("takeoff_source_manifests").select("*")
    .eq("tenant_id", tenantId).eq("project_id", projectId).eq("sheet_identity", source.sheetIdentity)
    .eq("authority_status", "authoritative").maybeSingle();
  let manifest = authoritative?.source_checksum === sourceChecksum ? authoritative : null;
  if (!manifest) {
    const { data: existingChecksum } = await db.from("takeoff_source_manifests").select("*")
      .eq("tenant_id", tenantId).eq("project_id", projectId).eq("sheet_identity", source.sheetIdentity)
      .eq("source_checksum", sourceChecksum).maybeSingle();
    manifest = existingChecksum;
  }
  if (!manifest) {
    const { data: latest } = await db.from("takeoff_source_manifests").select("manifest_version")
      .eq("tenant_id", tenantId).eq("project_id", projectId).eq("sheet_identity", source.sheetIdentity)
      .order("manifest_version", { ascending: false }).limit(1).maybeSingle();
    const { data: inserted, error } = await db.from("takeoff_source_manifests").insert({
      tenant_id: tenantId, project_id: projectId, document_id: documentId, sheet_id: sheet?.id ?? null,
      sheet_identity: source.sheetIdentity, discipline: source.discipline, sheet_number: source.sheetNumber,
      revision_label: source.revisionLabel, issue_date: source.issueDate, source_checksum: sourceChecksum,
      manifest_version: (latest?.manifest_version ?? 0) + 1,
      authority_status: authoritative ? "proposed" : "authoritative", created_by: actorUserId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    manifest = inserted;
    if (authoritative) {
      const { error: lineageError } = await db.from("takeoff_source_lineage").insert({
        tenant_id: tenantId, project_id: projectId, predecessor_id: authoritative.id,
        successor_id: manifest.id, status: "proposed",
      });
      if (lineageError) throw new Error(lineageError.message);
    }
  }

  const scope = scopeRequestToJobScope(scopeRequest, documentId, actorUserId);
  const scopeHash = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
  const { data: job, error: jobError } = await db.from("takeoff_jobs").insert({
    tenant_id: tenantId, project_id: projectId, scope_snapshot: scope, scope_hash: scopeHash, created_by: actorUserId,
  }).select("id").single();
  if (jobError) throw new Error(jobError.message);
  const { data: unit, error: unitError } = await db.from("takeoff_job_units").insert({
    job_id: job.id, tenant_id: tenantId, project_id: projectId, unit_type: "page", source_id: pageId,
    payload: { document_id: documentId, page_number: pageNumber, source_manifest_id: manifest.id },
  }).select("id").single();
  if (unitError) throw new Error(unitError.message);

  return {
    jobId: job.id,
    unitId: unit.id,
    manifestId: manifest.id,
    manifestVersion: manifest.manifest_version,
    authoritativeManifestVersion: authoritative?.manifest_version ?? manifest.manifest_version,
    authoritativeChecksum: authoritative?.source_checksum ?? manifest.source_checksum,
  };
}

export async function advanceTakeoffPageJob(db: GovernanceDb, tenantId: string, jobId: string, unitId: string, actorUserId: string, validated: boolean): Promise<void> {
  const states = validated
    ? ["validated", "split", "classified", "extracted", "quantity_validated", "review_ready"]
    : ["validated", "split", "classified", "extracted", "blocked"];
  for (const [entityType, entityId] of [["unit", unitId], ["job", jobId]] as const) {
    let rowVersion = 0;
    for (const nextState of states) {
      const { data, error } = await db.rpc("transition_takeoff_state", {
        p_tenant_id: tenantId, p_job_id: jobId, p_entity_type: entityType, p_entity_id: entityId,
        p_expected_row_version: rowVersion, p_next_state: nextState, p_actor_user_id: actorUserId,
        p_reason: validated ? "Automated page extraction validated" : "One or more candidates require correction",
        p_event_data: { page_extraction: true },
      });
      if (error) throw new Error(error.message);
      rowVersion = Number(data?.row_version ?? rowVersion + 1);
    }
  }
}

export async function releaseRejectedCandidateBlock(db: GovernanceDb, tenantId: string, projectId: string, jobId: string, actorUserId: string): Promise<boolean> {
  const { data: unresolved, error: unresolvedError } = await db.from("takeoff_items")
    .select("id,quantity_validation_status").eq("tenant_id", tenantId).eq("project_id", projectId)
    .eq("takeoff_job_id", jobId).in("review_status", ["suggested", "reviewed"]);
  if (unresolvedError) throw new Error(unresolvedError.message);
  if ((unresolved ?? []).some((candidate: { quantity_validation_status?: string | null }) => candidate.quantity_validation_status !== "validated")) return false;

  const { data: job, error: jobError } = await db.from("takeoff_jobs").select("id,state,row_version")
    .eq("id", jobId).eq("tenant_id", tenantId).eq("project_id", projectId).maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job || job.state !== "blocked") return false;
  const { data: units, error: unitError } = await db.from("takeoff_job_units").select("id,state,row_version")
    .eq("job_id", jobId).eq("tenant_id", tenantId);
  if (unitError) throw new Error(unitError.message);

  for (const unit of units ?? []) {
    if (unit.state !== "blocked") continue;
    let version = unit.row_version;
    for (const nextState of ["quantity_validated", "review_ready"] as const) {
      const transition = await db.rpc("transition_takeoff_state", {
        p_tenant_id: tenantId, p_job_id: jobId, p_entity_type: "unit", p_entity_id: unit.id,
        p_expected_row_version: version, p_next_state: nextState, p_actor_user_id: actorUserId,
        p_reason: "Unsupported candidate rejected; remaining quantities validated",
        p_event_data: { rejected_candidate_released_block: true },
      });
      if (transition.error) throw new Error(transition.error.message);
      version = Number(transition.data.row_version);
    }
  }
  let jobVersion = job.row_version;
  for (const nextState of ["quantity_validated", "review_ready"] as const) {
    const transition = await db.rpc("transition_takeoff_state", {
      p_tenant_id: tenantId, p_job_id: jobId, p_entity_type: "job", p_entity_id: jobId,
      p_expected_row_version: jobVersion, p_next_state: nextState, p_actor_user_id: actorUserId,
      p_reason: "Unsupported candidate rejected; remaining quantities validated",
      p_event_data: { rejected_candidate_released_block: true },
    });
    if (transition.error) throw new Error(transition.error.message);
    jobVersion = Number(transition.data.row_version);
  }
  return true;
}
