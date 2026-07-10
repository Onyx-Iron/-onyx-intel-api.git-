import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { recordTakeoffHistory } from "@/lib/takeoff/history";

export interface CivilMirrorRow {
  label: string;
  csi_code: string;
  quantity: number;
  unit: string;
  drawing_ref?: string | null;
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
    // Civil calculators (trench embedment, stockpile swell, entrance
    // stone) are deterministic engineering math grounded in user-entered
    // inputs, not an AI guess — implicitly approved, same as manual/
    // deterministic takeoff rows.
    created_by: actorUserId ?? null,
    review_status: "approved" as const,
    meta: {
      trade: "Earthwork",
      quantity_basis: null,
      drawing_ref: r.drawing_ref ?? null,
      location_tag: null,
      extraction_method: "civil_calculator",
      civil_source_table: sourceTable,
      civil_source_id: sourceId,
    },
  }));
  const { data: inserted, error } = await db.from("takeoff_items").insert(payload).select("id");
  if (error) {
    console.error(`[civil-mirror] takeoff_items insert failed for ${sourceTable}`, error);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (inserted ?? []) as any[]) {
    await recordTakeoffHistory(db, {
      tenantId, projectId, takeoffItemId: row.id, action: "created",
      actorUserId: actorUserId ?? null, after: { source: sourceTable },
    });
  }
  await syncTakeoffToEstimate(tenantId, projectId).catch((e) =>
    console.error(`[civil-mirror] estimate sync failed for ${sourceTable}`, e),
  );
}
