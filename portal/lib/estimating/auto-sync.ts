import { createServiceClient } from "@/lib/supabase/server";
import { buildEstimateImportRows, type CostCatalogForImport } from "@/lib/estimating/takeoff-import";
import { resolveCostsBatch } from "@/lib/cost/resolver";

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
  // Takeoff items that exist but are still pending_review/rejected and were
  // therefore excluded from this sync — visible so the UI can tell "nothing
  // new to import" apart from "N items are waiting on your review".
  pendingReview: number;
}

export async function syncTakeoffToEstimate(
  tenantId: string,
  projectId: string,
): Promise<AutoSyncResult> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const [takeoff, existing, catalog, project] = await Promise.all([
    anyDb
      .from("takeoff_items")
      .select("id,label,csi_code,division,quantity,unit,type,meta,review_status")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    anyDb
      .from("estimate_items")
      .select("source_takeoff_id,source_fingerprint,notes")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId),
    // Legacy per-tenant flat-rate catalog — kept as a fallback for tenants
    // that have manually seeded/overridden it (via /api/cost-catalog/seed),
    // but no longer the primary price source. See resolveCostsBatch below.
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
  ]);

  if (takeoff.error || existing.error || catalog.error) {
    console.error("[syncTakeoffToEstimate]", takeoff.error ?? existing.error ?? catalog.error);
    return { imported: 0, skipped: 0, priced: 0, unpriced: 0, review: 0, pendingReview: 0 };
  }

  // Real pricing engine: cost_codes catalog + tenant overrides/actuals +
  // regional/national cost_prices (see lib/cost/resolver.ts). This is what
  // the cost-catalog-v2 admin UI and commodity-index escalation actually
  // maintain — previously estimate pricing never consulted it at all and
  // relied solely on the legacy cost_catalog table above.
  const distinctCodes = [...new Set(
    (takeoff.data ?? [])
      .map((t: { csi_code?: string | null }) => t.csi_code)
      .filter((c: string | null | undefined): c is string => Boolean(c)),
  )] as string[];
  const region = { state: project.data?.state ?? undefined, city: undefined, metro: undefined, zip: undefined };
  const resolved = distinctCodes.length > 0
    ? await resolveCostsBatch(distinctCodes.map((code) => ({ cost_code: code, tenant_id: tenantId, region })))
    : [];

  // Merge: prefer a real resolver hit (tenant override/actuals/regional/
  // national); fall back to the legacy flat-rate catalog for any code the
  // resolver couldn't price (e.g. cost_codes row exists but no price data
  // yet). uom is intentionally omitted on resolver-sourced entries so
  // buildCostLookup's "${csi}|*" wildcard bucket is used — the resolver
  // prices by CSI code, not by unit of measure.
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
    existingEstimateItems: existing.data ?? [],
    costCatalog: mergedCatalog,
    projectId,
  });
  const priced = result.rows.filter((row) => row.pricing_status === "priced").length;
  const unpriced = result.rows.filter((row) => row.pricing_status === "unpriced").length;
  const review = result.rows.filter((row) => row.pricing_status === "review").length;
  const pendingReview = result.blockedByReview;

  if (result.rows.length === 0) return { imported: 0, skipped: result.skipped, priced, unpriced, review, pendingReview };

  const payload = result.rows.map((row) => ({ ...row, tenant_id: tenantId }));
  const { data, error } = await anyDb.from("estimate_items").insert(payload).select("id");
  if (error) {
    console.error("[syncTakeoffToEstimate] insert failed", error);
    return { imported: 0, skipped: result.skipped, priced: 0, unpriced: 0, review: 0, pendingReview };
  }
  return { imported: data?.length ?? 0, skipped: result.skipped, priced, unpriced, review, pendingReview };
}
