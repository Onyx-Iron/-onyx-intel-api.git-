import { createServiceClient } from "@/lib/supabase/server";
import { buildEstimateImportRows, scaledDirectCosts, type CostCatalogForImport, type EstimateImportRow, type ExistingEstimateForImport, type TakeoffItemForEstimate } from "@/lib/estimating/takeoff-import";
import { excludeUnscaledManualTakeoff } from "@/lib/estimating/unscaled-takeoff";
import { regionFromProject, resolveCostsBatch } from "@/lib/cost/resolver";
import { applyVersionPercentages, calculateItem } from "@/lib/estimating/calculations";
import { getOrCreateDraftVersion } from "@/lib/estimating/versioning";
import { allocateDirectCosts } from "../../supabase/functions/_shared/estimate-sync-contract";

/**
 * Pushes every APPROVED takeoff_items row for a project that isn't already
 * in the project's estimate (dedup by source_takeoff_id / fingerprint,
 * scoped across every version of that one estimate) into the current DRAFT
 * estimate version. Called automatically after any write to takeoff_items
 * so estimates stay in sync without a manual import step. Idempotent — safe
 * to call repeatedly; running it twice with unchanged takeoff data inserts
 * nothing new.
 *
 * Never writes to an approved/superseded/void version — if the estimate's
 * current version is locked, a fresh draft is created (copying the locked
 * version's items forward) and the import lands there instead. A later
 * quantity change updates the line on that draft in place. Approved,
 * superseded, and void versions are not updated.
 */
export interface AutoSyncResult {
  imported: number;
  updated: number;
  skipped: number;
  priced: number;
  unpriced: number;
  review: number;
  pendingReview: number;
  estimateId: string;
  versionId: string;
}

export async function syncTakeoffToEstimate(
  tenantId: string,
  projectId: string,
): Promise<AutoSyncResult> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { estimateId, versionId } = await getOrCreateDraftVersion(anyDb, tenantId, projectId, "system_autosync");

  // Filter non-approved rows in SQL — buildEstimateImportRows would drop
  // them anyway, but pulling every suggested/reviewed/rejected AI row on
  // large projects is wasted IO and cost-resolution work.
  const [takeoff, versionIds, catalog, project, versionRow, pendingReviewCount, calibrations] = await Promise.all([
    anyDb
      .from("takeoff_items")
      .select("id,label,csi_code,division,quantity,unit,type,meta,review_status,source_method,sheet_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .or("review_status.is.null,review_status.eq.approved")
      .order("created_at", { ascending: true }),
    anyDb
      .from("estimate_versions")
      .select("id")
      .eq("estimate_id", estimateId),
    anyDb
      .from("cost_catalog")
      .select("csi_code,uom,unit_cost")
      .eq("tenant_id", tenantId),
    anyDb
      .from("projects")
      .select("state, city, zip_code")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    anyDb
      .from("estimate_versions")
      .select("contingency_pct, overhead_pct, profit_pct")
      .eq("id", versionId)
      .single(),
    anyDb
      .from("takeoff_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("review_status", ["suggested", "reviewed", "rejected"]),
    anyDb
      .from("sheet_calibrations")
      .select("page_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("verified", true)
      .eq("status", "verified")
      .eq("active", true)
      .not("page_space_scale_factor", "is", null),
  ]);

  if (takeoff.error || catalog.error) {
    console.error("[syncTakeoffToEstimate]", takeoff.error ?? catalog.error);
    return emptySync(estimateId, versionId);
  }

  if (calibrations.error) {
    console.error("[syncTakeoffToEstimate] calibrations", calibrations.error);
  }
  const verifiedPageIds = new Set<string>(
    calibrations.error
      ? []
      : (calibrations.data ?? []).map((row: { page_id: string }) => row.page_id),
  );
  const takeoffRows = (takeoff.data ?? []) as Array<TakeoffItemForEstimate & { sheet_id?: string | null }>;
  const scaledTakeoff = excludeUnscaledManualTakeoff(takeoffRows, verifiedPageIds);

  // Dedup is scoped across every version belonging to this ONE estimate
  // (not just the current draft) — a draft created by copying an approved
  // version already contains that version's items, so this naturally skips
  // re-importing anything already present via the copy. STEP 4: "running
  // import twice must not duplicate estimate items."
  const { data: existing, error: existingErr } = await anyDb
    .from("estimate_items")
    .select("id, estimate_version_id, source_takeoff_id, source_fingerprint, notes, quantity, unit_cost, labor_cost, material_cost, equipment_cost")
    .in("estimate_version_id", (versionIds.data ?? []).map((v: { id: string }) => v.id));
  if (existingErr) {
    console.error("[syncTakeoffToEstimate]", existingErr);
    return emptySync(estimateId, versionId);
  }

  const distinctCodes = [...new Set(
    scaledTakeoff.items
      .map((t: { csi_code?: string | null }) => t.csi_code)
      .filter((c: string | null | undefined): c is string => Boolean(c)),
  )] as string[];
  const region = regionFromProject(project.data);
  const resolved = distinctCodes.length > 0
    ? await resolveCostsBatch(distinctCodes.map((code) => ({ cost_code: code, tenant_id: tenantId, region })))
    : [];

  // Per-CSI cost-category breakdown, when the resolver actually supplied
  // one (tenant override / regional / national cost_prices rows that carry
  // labor_cost/material_cost/equipment_cost). Falls back to null (handled
  // per-row below) when the resolver only returned a flat unit_cost — e.g.
  // the legacy cost_catalog fallback, which has never had a category split.
  const categoryBreakdownByCsi = new Map<string, { labor: number; material: number; equipment: number }>();
  for (const r of resolved) {
    if (r.source !== "none" && (r.labor_cost != null || r.material_cost != null || r.equipment_cost != null)) {
      categoryBreakdownByCsi.set(r.cost_code, {
        labor: r.labor_cost ?? 0,
        material: r.material_cost ?? 0,
        equipment: r.equipment_cost ?? 0,
      });
    }
  }

  const mergedCatalog: CostCatalogForImport[] = [
    ...resolved.filter((r) => r.source !== "none" && r.unit_cost > 0).map((r) => ({
      csi_code: r.cost_code,
      uom: r.uom ?? null,
      unit_cost: r.unit_cost,
      labor_cost: r.labor_cost ?? null,
      material_cost: r.material_cost ?? null,
      equipment_cost: r.equipment_cost ?? null,
      confidence: r.confidence,
      basis: r.price_scope === "national"
        ? "national" as const
        : r.price_scope === "location_index"
          ? "location_index" as const
          : "section" as const,
    })),
    ...(catalog.data ?? []),
  ];

  const result = buildEstimateImportRows({
    takeoffItems: scaledTakeoff.items,
    existingEstimateItems: existing ?? [],
    costCatalog: mergedCatalog,
    projectId,
    targetVersionId: versionId,
  });
  const priced = result.rows.filter((row) => row.pricing_status === "priced").length;
  const unpriced = result.rows.filter((row) => row.pricing_status === "unpriced").length;
  const review = result.rows.filter((row) => row.pricing_status === "review").length;
  // Prefer the SQL count (covers rows we never fetched); fall back to the
  // in-memory gate count if the head query failed.
  const pendingReview = pendingReviewCount.count ?? result.blockedByReview;

  if (result.rows.length === 0 && result.updates.length === 0) {
    return { imported: 0, updated: 0, skipped: result.skipped, priced, unpriced, review, pendingReview, estimateId, versionId };
  }

  const pct = {
    contingencyPct: versionRow.data?.contingency_pct ?? 0,
    overheadPct: versionRow.data?.overhead_pct ?? 0,
    profitPct: versionRow.data?.profit_pct ?? 0,
  };

  const payload = result.rows.map((row) => linePayload(tenantId, versionId, row, null, categoryBreakdownByCsi, pct));

  let updated = 0;
  const UPDATE_BATCH = 8;
  for (let i = 0; i < result.updates.length; i += UPDATE_BATCH) {
    const batch = result.updates.slice(i, i + UPDATE_BATCH);
    const counts = await Promise.all(batch.map(async (change) => {
      const fields = linePayload(tenantId, versionId, change.row, change.existing, categoryBreakdownByCsi, pct);
      const { created_by: createdBy, ...updateFields } = fields;
      void createdBy;
      const { data, error } = await anyDb
        .from("estimate_items")
        .update(updateFields)
        .eq("id", change.estimateItemId)
        .eq("estimate_version_id", versionId)
        .eq("tenant_id", tenantId)
        .select("id");
      if (error) {
        console.error("[syncTakeoffToEstimate] update failed", error);
        return 0;
      }
      return data?.length ?? 0;
    }));
    updated += counts.reduce((sum, count) => sum + count, 0);
  }

  let imported = 0;
  if (payload.length > 0) {
    const { data, error } = await anyDb.from("estimate_items").insert(payload).select("id");
    if (error) {
      console.error("[syncTakeoffToEstimate] insert failed", error);
      return { imported: 0, updated, skipped: result.skipped, priced: 0, unpriced: 0, review: 0, pendingReview, estimateId, versionId };
    }
    imported = data?.length ?? 0;
  }

  return { imported, updated, skipped: result.skipped, priced, unpriced, review, pendingReview, estimateId, versionId };
}

function emptySync(estimateId: string, versionId: string): AutoSyncResult {
  return { imported: 0, updated: 0, skipped: 0, priced: 0, unpriced: 0, review: 0, pendingReview: 0, estimateId, versionId };
}

function linePayload(
  tenantId: string,
  versionId: string,
  row: EstimateImportRow,
  existing: ExistingEstimateForImport | null,
  categoryBreakdownByCsi: Map<string, { labor: number; material: number; equipment: number }>,
  pct: { contingencyPct: number; overheadPct: number; profitPct: number },
) {
  const quantity = row.quantity ?? 0;
  const preserved = existing ? scaledDirectCosts(existing, row.quantity) : null;
  const breakdown = row.labor_cost != null || row.material_cost != null || row.equipment_cost != null
    ? { labor: row.labor_cost ?? 0, material: row.material_cost ?? 0, equipment: row.equipment_cost ?? 0 }
    : row.csi_code ? categoryBreakdownByCsi.get(row.csi_code) : undefined;
  // No breakdown available: the whole resolved unit_cost is booked as
  // material_cost. Do not fabricate a labor/equipment split that was not
  // resolved. An existing unit price is scaled instead of replaced.
  const allocated = preserved ?? allocateDirectCosts(quantity, row.unit_cost, breakdown ?? null);
  const laborCost = allocated.laborCost;
  const materialCost = allocated.materialCost;
  const equipmentCost = allocated.equipmentCost;
  const unitCost = preserved ? preserved.unitCost : row.unit_cost;

  const totalDirectCost = laborCost + materialCost + equipmentCost;
  const { contingency, overhead, profit } = applyVersionPercentages(totalDirectCost, 0, pct);
  const calc = calculateItem({
    laborCost, materialCost, equipmentCost, quantity,
    indirectCost: 0, contingency, overhead, profit,
  });

  return {
    tenant_id: tenantId,
    project_id: row.project_id,
    estimate_version_id: versionId,
    description: row.description,
    csi_code: row.csi_code,
    cost_code: row.csi_code,
    trade: row.trade,
    item_type: row.item_type,
    quantity: row.quantity,
    uom: row.uom,
    unit_cost: unitCost,
    labor_cost: laborCost,
    material_cost: materialCost,
    equipment_cost: equipmentCost,
    total_direct_cost: calc.totalDirectCost,
    contingency,
    overhead,
    profit,
    total_price: calc.totalPrice,
    unit_price: calc.unitPrice,
    source_takeoff_id: row.source_takeoff_id,
    source_fingerprint: row.source_fingerprint,
    quantity_basis: row.quantity_basis,
    drawing_ref: row.drawing_ref,
    location_tag: row.location_tag,
    pricing_status: row.pricing_status,
    notes: row.notes,
    created_by: "system_takeoff_sync",
    updated_by: "system_takeoff_sync",
  };
}
