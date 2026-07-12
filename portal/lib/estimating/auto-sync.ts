import { createServiceClient } from "@/lib/supabase/server";
import { buildEstimateImportRows, type CostCatalogForImport } from "@/lib/estimating/takeoff-import";
import { resolveCostsBatch } from "@/lib/cost/resolver";
import { applyVersionPercentages, calculateItem } from "@/lib/estimating/calculations";
import { getOrCreateDraftVersion } from "@/lib/estimating/versioning";

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
 * version's items forward) and the import lands there instead. This is the
 * mechanism behind "quantity change updates the linked draft, never
 * silently modifies an approved version" (estimating-core-consolidation
 * milestone, STEP 4).
 */
export interface AutoSyncResult {
  imported: number;
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

  const [takeoff, versionIds, catalog, project, versionRow] = await Promise.all([
    anyDb
      .from("takeoff_items")
      .select("id,label,csi_code,division,quantity,unit,type,meta,review_status")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
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
      .select("state,city")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    anyDb
      .from("estimate_versions")
      .select("contingency_pct, overhead_pct, profit_pct")
      .eq("id", versionId)
      .single(),
  ]);

  if (takeoff.error || catalog.error) {
    console.error("[syncTakeoffToEstimate]", takeoff.error ?? catalog.error);
    return { imported: 0, skipped: 0, priced: 0, unpriced: 0, review: 0, pendingReview: 0, estimateId, versionId };
  }

  // Dedup is scoped across every version belonging to this ONE estimate
  // (not just the current draft) — a draft created by copying an approved
  // version already contains that version's items, so this naturally skips
  // re-importing anything already present via the copy. STEP 4: "running
  // import twice must not duplicate estimate items."
  const { data: existing, error: existingErr } = await anyDb
    .from("estimate_items")
    .select("source_takeoff_id,source_fingerprint,notes")
    .in("estimate_version_id", (versionIds.data ?? []).map((v: { id: string }) => v.id));
  if (existingErr) {
    console.error("[syncTakeoffToEstimate]", existingErr);
    return { imported: 0, skipped: 0, priced: 0, unpriced: 0, review: 0, pendingReview: 0, estimateId, versionId };
  }

  const distinctCodes = [...new Set(
    (takeoff.data ?? [])
      .map((t: { csi_code?: string | null }) => t.csi_code)
      .filter((c: string | null | undefined): c is string => Boolean(c)),
  )] as string[];
  const region = { state: project.data?.state ?? undefined, city: undefined, metro: undefined, zip: undefined };
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
      uom: null,
      unit_cost: r.unit_cost,
    })),
    ...(catalog.data ?? []),
  ];

  const result = buildEstimateImportRows({
    takeoffItems: takeoff.data ?? [],
    existingEstimateItems: existing ?? [],
    costCatalog: mergedCatalog,
    projectId,
  });
  const priced = result.rows.filter((row) => row.pricing_status === "priced").length;
  const unpriced = result.rows.filter((row) => row.pricing_status === "unpriced").length;
  const review = result.rows.filter((row) => row.pricing_status === "review").length;
  const pendingReview = result.blockedByReview;

  if (result.rows.length === 0) {
    return { imported: 0, skipped: result.skipped, priced, unpriced, review, pendingReview, estimateId, versionId };
  }

  const pct = {
    contingencyPct: versionRow.data?.contingency_pct ?? 0,
    overheadPct: versionRow.data?.overhead_pct ?? 0,
    profitPct: versionRow.data?.profit_pct ?? 0,
  };

  const payload = result.rows.map((row) => {
    const quantity = row.quantity ?? 0;
    const breakdown = row.csi_code ? categoryBreakdownByCsi.get(row.csi_code) : undefined;
    // No breakdown available: the whole resolved unit_cost is booked as
    // material_cost (a documented, deliberate default — see
    // docs/milestones/estimating-core-consolidation/REMAINING_RISKS.md).
    // Do NOT fabricate a labor/equipment split that wasn't actually resolved.
    const laborCost = (breakdown?.labor ?? 0) * quantity;
    const materialCost = (breakdown ? breakdown.material : (row.unit_cost ?? 0)) * quantity;
    const equipmentCost = (breakdown?.equipment ?? 0) * quantity;

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
      unit_cost: row.unit_cost,
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
  });

  const { data, error } = await anyDb.from("estimate_items").insert(payload).select("id");
  if (error) {
    console.error("[syncTakeoffToEstimate] insert failed", error);
    return { imported: 0, skipped: result.skipped, priced: 0, unpriced: 0, review: 0, pendingReview, estimateId, versionId };
  }
  return { imported: data?.length ?? 0, skipped: result.skipped, priced, unpriced, review, pendingReview, estimateId, versionId };
}
