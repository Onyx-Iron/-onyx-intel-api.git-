import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getOrCreateDraftVersion, getServiceDb } from "@/lib/estimating/versioning";
import { calculateItem } from "@/lib/estimating/calculations";

export const runtime = "nodejs";

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
 * in the estimate. Returns { added, skipped }.
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
  const { data: versionItems } = await db
    .from("estimate_items")
    .select("source_takeoff_id")
    .in("estimate_version_id", (allVersionsOfEstimate ?? []).map((v: { id: string }) => v.id));
  const seen = new Set<string>((versionItems ?? []).map((r: { source_takeoff_id: string | null }) => r.source_takeoff_id).filter(Boolean));

  const toInsert: Record<string, unknown>[] = [];

  const { data: takeoffs } = await db
    .from("takeoff_items")
    .select("id, cost_code:csi_code, description:label, total_qty:quantity, uom:unit, estimated_unit_cost:rate, review_status")
    .eq("tenant_id", tenantId).eq("project_id", body.project_id)
    .or("review_status.is.null,review_status.eq.approved");
  let blockedByReview = 0;
  for (const t of takeoffs ?? []) {
    if (seen.has(t.id)) continue;
    // Belt-and-suspenders: SQL filter above is authoritative; keep the
    // in-memory check so a PostgREST quirk cannot smuggle unapproved rows.
    if (t.review_status === "suggested" || t.review_status === "reviewed" || t.review_status === "rejected") {
      blockedByReview++;
      continue;
    }
    const unitCost = Number(t.estimated_unit_cost ?? 0);
    const quantity = Number(t.total_qty ?? 0);
    // No cost-category breakdown available from a raw takeoff row — split
    // by the same 40/45/15 labor/material/equipment heuristic the legacy
    // seed route used, documented here rather than silently invented anew.
    const laborCost = unitCost * 0.40 * quantity;
    const materialCost = unitCost * 0.45 * quantity;
    const equipmentCost = unitCost * 0.15 * quantity;
    const calc = calculateItem({ laborCost, materialCost, equipmentCost, quantity });
    toInsert.push({
      tenant_id: tenantId, project_id: body.project_id, estimate_version_id: versionId,
      source_takeoff_id: t.id, cost_code: t.cost_code, csi_code: t.cost_code,
      description: t.description, quantity, uom: t.uom ?? null,
      labor_cost: laborCost, material_cost: materialCost, equipment_cost: equipmentCost,
      total_direct_cost: calc.totalDirectCost, total_price: calc.totalPrice, unit_price: calc.unitPrice,
      pricing_status: "manual", created_by: userId, updated_by: userId,
    });
  }

  const { data: manual } = await db
    .from("manual_takeoffs")
    .select("id, cost_code, takeoff_type, quantity, unit")
    .eq("tenant_id", tenantId).eq("project_id", body.project_id);
  for (const m of manual ?? []) {
    if (seen.has(m.id)) continue;
    const calc = calculateItem({ quantity: Number(m.quantity ?? 0) });
    toInsert.push({
      tenant_id: tenantId, project_id: body.project_id, estimate_version_id: versionId,
      source_takeoff_id: m.id, cost_code: m.cost_code, csi_code: m.cost_code,
      description: `Manual ${m.takeoff_type}`, quantity: Number(m.quantity ?? 0), uom: m.unit,
      labor_cost: 0, material_cost: 0, equipment_cost: 0,
      total_direct_cost: calc.totalDirectCost, total_price: calc.totalPrice, unit_price: calc.unitPrice,
      pricing_status: "manual", created_by: userId, updated_by: userId,
    });
  }

  let added = 0;
  if (toInsert.length > 0) {
    const { data, error } = await db.from("estimate_items").insert(toInsert).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    added = data?.length ?? toInsert.length;
  }

  return NextResponse.json({ added, skipped: seen.size, blocked_by_review: blockedByReview });
}
