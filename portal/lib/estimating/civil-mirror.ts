import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { recordTakeoffHistoryBatch } from "@/lib/takeoff/history";
import { provenanceForNewItem } from "@/lib/takeoff/provenance";

export interface CivilMirrorRow {
  label: string;
  csi_code: string;
  quantity: number;
  unit: string;
  drawing_ref?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Mirrors a civil/utility Sheet Canvas save (pipe runs, stockpiles,
 * construction entrances) into takeoff_items and syncs the estimate.
 *
 * These tools each persist to their own dedicated table (civil_pipe_runs,
 * civil_utility_takeoffs, civil_stockpiles, civil_construction_entrances)
 * because they carry engineering inputs an estimate line can't hold
 * (invert elevations, bedding/haunch depths, swell factors) — but nothing
 * ever read those tables back into an estimate. This bridges that gap the
 * same way lib/estimating/auto-sync.ts bridges takeoff_items -> estimate_items.
 */
const MUTABLE_ESTIMATE_STATUSES = new Set(["draft", "review"]);

/**
 * Draft and review estimate lines can follow the source measurement.
 * Approved, superseded, and void versions stay immutable.
 */
export function estimateItemIdsOnMutableVersions(
  linked: Array<{ id: string; estimate_version_id: string }>,
  versions: Array<{ id: string; status: string }>,
): string[] {
  const mutable = new Set(
    versions.filter((version) => MUTABLE_ESTIMATE_STATUSES.has(version.status)).map((version) => version.id),
  );
  return linked.filter((item) => mutable.has(item.estimate_version_id)).map((item) => item.id);
}

export interface CivilMirrorMatch {
  sourceTable: string;
  sourceId?: string;
  clientKey?: string;
  projectId?: string;
}

/**
 * Drop takeoff rows mirrored from a civil source, and the draft/review
 * estimate lines those rows already priced. Used when the source run is
 * deleted or replaced so the bid does not keep quantities the user removed.
 */
export async function removeCivilMirrors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  match: CivilMirrorMatch,
  actorUserId?: string | null,
): Promise<{ removedTakeoff: number; removedEstimateLines: number }> {
  const metaMatch: Record<string, string> = { civil_source_table: match.sourceTable };
  if (match.sourceId) metaMatch.civil_source_id = match.sourceId;
  else if (match.clientKey) metaMatch.client_key = match.clientKey;
  else return { removedTakeoff: 0, removedEstimateLines: 0 };

  let takeoffQuery = db
    .from("takeoff_items")
    .select("id, project_id, label, quantity, unit, csi_code, meta")
    .eq("tenant_id", tenantId)
    .contains("meta", metaMatch);
  if (match.projectId) takeoffQuery = takeoffQuery.eq("project_id", match.projectId);

  const { data: mirrors, error: mirrorErr } = await takeoffQuery;
  if (mirrorErr) throw new Error(mirrorErr.message);
  const rows = (mirrors ?? []) as Array<{
    id: string;
    project_id: string;
    label?: string;
    quantity?: number;
    unit?: string;
    csi_code?: string;
    meta?: Record<string, unknown>;
  }>;
  if (rows.length === 0) return { removedTakeoff: 0, removedEstimateLines: 0 };

  const ids = rows.map((row) => row.id);
  const projectIds = [...new Set(rows.map((row) => row.project_id).filter(Boolean))];

  let removedEstimateLines = 0;
  if (projectIds.length > 0) {
    const { data: linked, error: linkedErr } = await db
      .from("estimate_items")
      .select("id, estimate_version_id")
      .eq("tenant_id", tenantId)
      .in("project_id", projectIds)
      .in("source_takeoff_id", ids);
    if (linkedErr) throw new Error(linkedErr.message);

    const linkedRows = (linked ?? []) as Array<{ id: string; estimate_version_id: string }>;
    const versionIds = [...new Set(linkedRows.map((item) => item.estimate_version_id))];
    if (versionIds.length > 0 && linkedRows.length > 0) {
      const { data: versions, error: versionErr } = await db
        .from("estimate_versions")
        .select("id, status")
        .in("id", versionIds);
      if (versionErr) throw new Error(versionErr.message);
      const toRemove = estimateItemIdsOnMutableVersions(
        linkedRows,
        (versions ?? []) as Array<{ id: string; status: string }>,
      );
      if (toRemove.length > 0) {
        const { error: deleteEstimateErr } = await db
          .from("estimate_items")
          .delete()
          .in("id", toRemove)
          .eq("tenant_id", tenantId);
        if (deleteEstimateErr) throw new Error(deleteEstimateErr.message);
        removedEstimateLines = toRemove.length;
      }
    }
  }

  await recordTakeoffHistoryBatch(
    db,
    rows.map((row) => ({
      tenantId,
      projectId: row.project_id,
      takeoffItemId: row.id,
      action: "deleted" as const,
      actorUserId: actorUserId ?? null,
      before: {
        label: row.label ?? null,
        quantity: row.quantity ?? null,
        unit: row.unit ?? null,
        csi_code: row.csi_code ?? null,
        meta: row.meta ?? null,
      },
    })),
  );

  const { error: deleteTakeoffErr } = await db
    .from("takeoff_items")
    .delete()
    .in("id", ids)
    .eq("tenant_id", tenantId);
  if (deleteTakeoffErr) throw new Error(deleteTakeoffErr.message);

  return { removedTakeoff: rows.length, removedEstimateLines };
}

export async function mirrorCivilItemsToTakeoff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  projectId: string,
  pageId: string | null,
  sourceTable: string,
  sourceId: string,
  rows: CivilMirrorRow[],
  actorUserId?: string | null,
): Promise<void> {
  if (rows.length === 0) return;
  // Replacing a source (edited length, cost code, or a second save of the
  // same wall) must not leave the previous recipe lines on the estimate.
  if (sourceId) {
    await removeCivilMirrors(db, tenantId, { sourceTable, sourceId, projectId }, actorUserId);
  }
  const stamp = provenanceForNewItem({ sourceMethod: "civil_calculator" });
  const payload = rows.map((r) => ({
    tenant_id: tenantId,
    project_id: projectId,
    label: r.label,
    csi_code: r.csi_code,
    division: r.csi_code.slice(0, 2),
    quantity: r.quantity,
    unit: r.unit,
    type: "takeoff_import",
    page: 0,
    document_id: pageId,
    sheet_id: pageId,
    // Civil calculators (trench embedment, stockpile swell, entrance
    // stone) are deterministic engineering math grounded in user-entered
    // inputs, not an AI guess — implicitly approved, same as manual/
    // deterministic takeoff rows.
    created_by: actorUserId ?? null,
    review_status: stamp.review_status,
    source_method: stamp.source_method,
    origin_actor: stamp.origin_actor,
    origin_method: stamp.origin_method,
    origin_edited: stamp.origin_edited,
    meta: {
      trade: "Earthwork",
      quantity_basis: null,
      drawing_ref: r.drawing_ref ?? null,
      location_tag: null,
      extraction_method: "civil_calculator",
      origin_actor: stamp.origin_actor,
      origin_method: stamp.origin_method,
      civil_source_table: sourceTable,
      civil_source_id: sourceId,
      ...(r.meta ?? {}),
    },
  }));
  const { data: inserted, error } = await db.from("takeoff_items").insert(payload).select("id");
  if (error) {
    console.error(`[civil-mirror] takeoff_items insert failed for ${sourceTable}`, error);
    return;
  }
  await recordTakeoffHistoryBatch(
    db,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((inserted ?? []) as any[]).map((row) => ({
      tenantId,
      projectId,
      takeoffItemId: row.id as string,
      action: "created" as const,
      actorUserId: actorUserId ?? null,
      after: { source: sourceTable },
    })),
  );
  await syncTakeoffToEstimate(tenantId, projectId).catch((e) =>
    console.error(`[civil-mirror] estimate sync failed for ${sourceTable}`, e),
  );
}
