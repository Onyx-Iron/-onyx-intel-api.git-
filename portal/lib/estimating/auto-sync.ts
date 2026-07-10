import { createServiceClient } from "@/lib/supabase/server";
import { buildEstimateImportRows } from "@/lib/estimating/takeoff-import";

/**
 * Pushes every takeoff_items row for a project that isn't already in
 * estimate_items (dedup by source_takeoff_id / fingerprint, same as the
 * manual "Import from Takeoff" button) into estimate_items. Called
 * automatically after any write to takeoff_items so estimates stay in sync
 * without a manual import step. Safe to call repeatedly — idempotent.
 */
export interface AutoSyncResult {
  imported: number;
  skipped: number;
  priced: number;
  unpriced: number;
  review: number;
}

export async function syncTakeoffToEstimate(
  tenantId: string,
  projectId: string,
): Promise<AutoSyncResult> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const [takeoff, existing, catalog] = await Promise.all([
    anyDb
      .from("takeoff_items")
      .select("id,label,csi_code,division,quantity,unit,type,meta")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    anyDb
      .from("estimate_items")
      .select("source_takeoff_id,source_fingerprint,notes")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId),
    anyDb
      .from("cost_catalog")
      .select("csi_code,uom,unit_cost")
      .eq("tenant_id", tenantId),
  ]);

  if (takeoff.error || existing.error || catalog.error) {
    console.error("[syncTakeoffToEstimate]", takeoff.error ?? existing.error ?? catalog.error);
    return { imported: 0, skipped: 0, priced: 0, unpriced: 0, review: 0 };
  }

  const result = buildEstimateImportRows({
    takeoffItems: takeoff.data ?? [],
    existingEstimateItems: existing.data ?? [],
    costCatalog: catalog.data ?? [],
    projectId,
  });
  const priced = result.rows.filter((row) => row.pricing_status === "priced").length;
  const unpriced = result.rows.filter((row) => row.pricing_status === "unpriced").length;
  const review = result.rows.filter((row) => row.pricing_status === "review").length;

  if (result.rows.length === 0) return { imported: 0, skipped: result.skipped, priced, unpriced, review };

  const payload = result.rows.map((row) => ({ ...row, tenant_id: tenantId }));
  const { data, error } = await anyDb.from("estimate_items").insert(payload).select("id");
  if (error) {
    console.error("[syncTakeoffToEstimate] insert failed", error);
    return { imported: 0, skipped: result.skipped, priced: 0, unpriced: 0, review: 0 };
  }
  return { imported: data?.length ?? 0, skipped: result.skipped, priced, unpriced, review };
}
