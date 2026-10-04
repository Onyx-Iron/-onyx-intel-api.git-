import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getOrCreateDraftVersion, getServiceDb } from "@/lib/estimating/versioning";
import { calculateItem } from "@/lib/estimating/calculations";
import { regionFromProject, resolveCostsBatch, type CostResolveResult } from "@/lib/cost/resolver";
import { legacyHeuristicUnitCost, seedLineCosts } from "@/lib/estimating/seed-pricing";
import { unitsCompatible } from "@/lib/estimating/takeoff-import";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

export const runtime = "nodejs";

function usableResolved(
  resolved: CostResolveResult | null | undefined,
  quantityUnit: string | null | undefined,
): CostResolveResult | null {
  if (!resolved || resolved.source === "none" || !(resolved.unit_cost > 0)) return null;
  if (!unitsCompatible(resolved.uom, quantityUnit)) return null;
  return resolved;
}

/**
 * POST /api/estimate/matrix/seed { project_id }
 *
 * Populates the current DRAFT estimate version (estimate_items) from
 * existing rows in takeoff_items and manual_takeoffs — the manual "Load
 * from Takeoffs" button in the pricing-matrix UI. Writes to estimate_items,
 * NOT the deprecated project_estimates table (estimating-core-consolidation
 * milestone). Enforces the same AI-review gate as syncTakeoffToEstimate:
 * takeoff_items with review_status suggested|reviewed|rejected are skipped
 * so unverified AI quantities cannot reach draft totals via this path.
 * Never writes to a locked version (getOrCreateDraftVersion opens a new
 * draft if the current one is locked) and dedups by source_takeoff_id.
 *
 * Idempotent: skips items whose source_takeoff_id already exists anywhere
 * in the estimate. Draft lines that still use the retired 40/45/15 split
 * are repriced in place from the catalog. Approved versions are never
 * updated — a locked current version is copied into a new draft first.
 * Returns { added, skipped, repriced }.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { project_id?: string };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertProjectBelongsToTenant(body.project_id, tenantId);
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
  }

  const db = await getServiceDb();
  const { estimateId, versionId } = await getOrCreateDraftVersion(db, tenantId, body.project_id, userId);

  // Dedup scoped across every version of this one estimate (same rule
  // syncTakeoffToEstimate uses) — a draft seeded from a locked version
  // already contains that version's items, so re-running the seed action
  // correctly sees them as already-present rather than re-adding them.
  const { data: allVersionsOfEstimate } = await db
    .from("estimate_versions").select("id").eq("estimate_id", estimateId);
  const versionIdList = (allVersionsOfEstimate ?? []).map((v: { id: string }) => v.id);
  const versionItems = versionIdList.length === 0
    ? { rows: [] as Array<{ source_takeoff_id: string | null }>, error: null }
    : await fetchAllPages<{ source_takeoff_id: string | null }>((from, to) =>
      db
        .from("estimate_items")
        .select("source_takeoff_id")
        .in("estimate_version_id", versionIdList)
        .order("id", { ascending: true })
        .range(from, to),
    );
  if (versionItems.error) return NextResponse.json({ error: versionItems.error }, { status: 500 });
  const seen = new Set<string>(versionItems.rows.map((r) => r.source_takeoff_id).filter((id): id is string => Boolean(id)));

  const toInsert: Record<string, unknown>[] = [];

  interface DraftLine {
    id: string;
    source_takeoff_id: string | null;
    cost_code: string | null;
    csi_code: string | null;
    quantity: number | null;
    uom: string | null;
    labor_cost: number | null;
    material_cost: number | null;
    equipment_cost: number | null;
  }
  interface SeedTakeoff {
    id: string;
    cost_code: string | null;
    description: string | null;
    total_qty: number | null;
    uom: string | null;
    estimated_unit_cost: number | null;
    review_status: string | null;
  }
  const [takeoffPage, { data: project }, draftPage] = await Promise.all([
    fetchAllPages<SeedTakeoff>((from, to) =>
      db
        .from("takeoff_items")
        .select("id, cost_code:csi_code, description:label, total_qty:quantity, uom:unit, estimated_unit_cost:rate, review_status")
        .eq("tenant_id", tenantId).eq("project_id", body.project_id)
        .or("review_status.is.null,review_status.eq.approved")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    db
      .from("projects")
      .select("state, city, zip_code")
      .eq("id", body.project_id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    fetchAllPages<DraftLine>((from, to) =>
      db
        .from("estimate_items")
        .select("id, source_takeoff_id, cost_code, csi_code, quantity, uom, labor_cost, material_cost, equipment_cost")
        .eq("tenant_id", tenantId)
        .eq("estimate_version_id", versionId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (takeoffPage.error) return NextResponse.json({ error: takeoffPage.error }, { status: 500 });
  if (draftPage.error) return NextResponse.json({ error: draftPage.error }, { status: 500 });
  const takeoffs = takeoffPage.rows;
  const draftLines = draftPage.rows;
  const legacyLines = draftLines.filter((row) => legacyHeuristicUnitCost(
    Number(row.labor_cost ?? 0),
    Number(row.material_cost ?? 0),
    Number(row.equipment_cost ?? 0),
    Number(row.quantity ?? 0),
  ) != null);
  const codes = [...new Set(
    [
      ...takeoffs.map((t) => t.cost_code),
      ...legacyLines.map((row) => row.cost_code || row.csi_code),
    ].filter((code): code is string => typeof code === "string" && code.length > 0),
  )];
  const resolved = codes.length > 0
    ? await resolveCostsBatch(codes.map((cost_code) => ({
        cost_code,
        tenant_id: tenantId,
        region: regionFromProject(project),
      })))
    : [];
  const resolvedByCode = new Map(resolved.map((row) => [row.cost_code, row]));
  const takeoffById = new Map(takeoffs.map((t) => [t.id, t]));
  let repriced = 0;
  const repriceUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  for (const row of legacyLines) {
    const quantity = Number(row.quantity ?? 0);
    const implied = legacyHeuristicUnitCost(
      Number(row.labor_cost ?? 0),
      Number(row.material_cost ?? 0),
      Number(row.equipment_cost ?? 0),
      quantity,
    );
    const takeoff = row.source_takeoff_id ? takeoffById.get(row.source_takeoff_id) : undefined;
    const takeoffUnit = takeoff?.estimated_unit_cost != null && Number(takeoff.estimated_unit_cost) > 0
      ? Number(takeoff.estimated_unit_cost)
      : implied;
    const code = row.cost_code || row.csi_code;
    const costs = seedLineCosts(
      quantity,
      takeoffUnit,
      usableResolved(code ? resolvedByCode.get(code) : null, row.uom),
    );
    const calc = calculateItem({
      laborCost: costs.labor_cost,
      materialCost: costs.material_cost,
      equipmentCost: costs.equipment_cost,
      quantity,
    });
    repriceUpdates.push({
      id: row.id,
      patch: {
        unit_cost: costs.unit_cost,
        labor_cost: costs.labor_cost,
        material_cost: costs.material_cost,
        equipment_cost: costs.equipment_cost,
        total_direct_cost: calc.totalDirectCost,
        total_price: calc.totalPrice,
        unit_price: calc.unitPrice,
        pricing_status: costs.pricing_status,
        updated_by: userId,
      },
    });
  }
  const REPRICE_BATCH = 8;
  for (let i = 0; i < repriceUpdates.length; i += REPRICE_BATCH) {
    const batch = repriceUpdates.slice(i, i + REPRICE_BATCH);
    const results = await Promise.all(batch.map(async (update) => {
      const { error } = await db
        .from("estimate_items")
        .update(update.patch)
        .eq("id", update.id)
        .eq("estimate_version_id", versionId)
        .eq("tenant_id", tenantId);
      return error ? 0 : 1;
    }));
    repriced += results.reduce<number>((sum, n) => sum + n, 0);
  }

  let blockedByReview = 0;
  for (const t of takeoffs) {
    if (seen.has(t.id)) continue;
    // Belt-and-suspenders: SQL filter above is authoritative; keep the
    // in-memory check so a PostgREST quirk cannot smuggle unapproved rows.
    if (t.review_status === "suggested" || t.review_status === "reviewed" || t.review_status === "rejected") {
      blockedByReview++;
      continue;
    }
    const quantity = Number(t.total_qty ?? 0);
    const costs = seedLineCosts(
      quantity,
      t.estimated_unit_cost == null ? null : Number(t.estimated_unit_cost),
      usableResolved(t.cost_code ? resolvedByCode.get(t.cost_code) : null, t.uom),
    );
    const calc = calculateItem({
      laborCost: costs.labor_cost,
      materialCost: costs.material_cost,
      equipmentCost: costs.equipment_cost,
      quantity,
    });
    toInsert.push({
      tenant_id: tenantId, project_id: body.project_id, estimate_version_id: versionId,
      source_takeoff_id: t.id, cost_code: t.cost_code, csi_code: t.cost_code,
      description: t.description, quantity, uom: t.uom ?? null,
      unit_cost: costs.unit_cost,
      labor_cost: costs.labor_cost, material_cost: costs.material_cost, equipment_cost: costs.equipment_cost,
      total_direct_cost: calc.totalDirectCost, total_price: calc.totalPrice, unit_price: calc.unitPrice,
      pricing_status: costs.pricing_status, created_by: userId, updated_by: userId,
    });
  }

  const manual = await fetchAllPages<{
    id: string;
    cost_code: string | null;
    takeoff_type: string;
    quantity: number | null;
    unit: string | null;
  }>((from, to) =>
    db
      .from("manual_takeoffs")
      .select("id, cost_code, takeoff_type, quantity, unit")
      .eq("tenant_id", tenantId)
      .eq("project_id", body.project_id)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (manual.error) return NextResponse.json({ error: manual.error }, { status: 500 });
  for (const m of manual.rows) {
    if (seen.has(m.id)) continue;
    const calc = calculateItem({ quantity: Number(m.quantity ?? 0) });
    toInsert.push({
      tenant_id: tenantId, project_id: body.project_id, estimate_version_id: versionId,
      source_takeoff_id: m.id, cost_code: m.cost_code, csi_code: m.cost_code,
      description: `Manual ${m.takeoff_type}`, quantity: Number(m.quantity ?? 0), uom: m.unit,
      labor_cost: 0, material_cost: 0, equipment_cost: 0,
      total_direct_cost: calc.totalDirectCost, total_price: calc.totalPrice, unit_price: calc.unitPrice,
      pricing_status: "unpriced", created_by: userId, updated_by: userId,
    });
  }

  let added = 0;
  if (toInsert.length > 0) {
    const { error } = await db.from("estimate_items").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    added = toInsert.length;
  }

  return NextResponse.json({ added, skipped: seen.size, blocked_by_review: blockedByReview, repriced });
}
