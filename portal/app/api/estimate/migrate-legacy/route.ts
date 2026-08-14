import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { calculateItem, applyVersionPercentages } from "@/lib/estimating/calculations";
import { getOrCreateDraftVersion, getServiceDb } from "@/lib/estimating/versioning";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { project_id?: string };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertProjectBelongsToTenant(body.project_id, tenantId);
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (error) {
    if (error instanceof PermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
  }

  const db = await getServiceDb();
  const { data: legacyItems, error: legacyError } = await db
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", body.project_id)
    .is("estimate_version_id", null);
  if (legacyError) return NextResponse.json({ error: legacyError.message }, { status: 500 });
  if (!legacyItems?.length) return NextResponse.json({ migrated: 0 });

  const { versionId } = await getOrCreateDraftVersion(db, tenantId, body.project_id, userId);
  const { data: version, error: versionError } = await db
    .from("estimate_versions")
    .select("contingency_pct, overhead_pct, profit_pct")
    .eq("id", versionId)
    .single();
  if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 });

  const percentages = {
    contingencyPct: Number(version.contingency_pct ?? 0),
    overheadPct: Number(version.overhead_pct ?? 0),
    profitPct: Number(version.profit_pct ?? 0),
  };
  const payload = legacyItems.map((item: Record<string, unknown>, index: number) => {
    const quantity = Number(item.quantity ?? 0);
    const direct = Number(item.unit_cost ?? 0) * quantity;
    const itemType = String(item.item_type ?? "material");
    const costs = {
      laborCost: itemType === "labour" || itemType === "labor" ? direct : 0,
      materialCost: itemType === "material" ? direct : 0,
      equipmentCost: itemType === "equipment" ? direct : 0,
      subcontractCost: itemType === "subcontract" ? direct : 0,
    };
    const derived = applyVersionPercentages(direct, 0, percentages);
    const calculated = calculateItem({
      ...costs,
      quantity,
      contingency: derived.contingency,
      overhead: derived.overhead,
      profit: derived.profit,
    });
    return {
      ...item,
      estimate_version_id: versionId,
      cost_code: item.cost_code ?? item.csi_code ?? null,
      labor_cost: costs.laborCost,
      material_cost: costs.materialCost,
      equipment_cost: costs.equipmentCost,
      subcontract_cost: costs.subcontractCost,
      total_direct_cost: calculated.totalDirectCost,
      contingency: derived.contingency,
      overhead: derived.overhead,
      profit: derived.profit,
      total_price: calculated.totalPrice,
      unit_price: calculated.unitPrice,
      sort_order: Number(item.sort_order ?? index),
      updated_by: userId,
    };
  });

  const { error: updateError } = await db.from("estimate_items").upsert(payload, { onConflict: "id" });
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 422 });
  return NextResponse.json({ migrated: payload.length, version_id: versionId });
}
