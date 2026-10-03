import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getOrCreateDraftVersion, getServiceDb } from "@/lib/estimating/versioning";
import { calculateItem } from "@/lib/estimating/calculations";
import { resolveCostsBatch } from "@/lib/cost/resolver";
import { isUnpricedDraftLine, seedLineCosts } from "@/lib/estimating/seed-pricing";

export const runtime = "nodejs";

/**
 * POST /api/estimate/matrix/price-unpriced { project_id }
 *
 * Fills zero draft lines from the catalog (override, actuals, regional ZIP
 * or state, then national). A line that already has a unit price or any
 * direct dollars is left alone. Approved versions are not updated.
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
  const { versionId } = await getOrCreateDraftVersion(db, tenantId, body.project_id, userId);
  const [{ data: rows }, { data: project }] = await Promise.all([
    db.from("estimate_items")
      .select("id, cost_code, csi_code, quantity, labor_cost, material_cost, equipment_cost, unit_cost")
      .eq("tenant_id", tenantId)
      .eq("estimate_version_id", versionId),
    db.from("projects")
      .select("state, zip_code")
      .eq("id", body.project_id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  interface UnpricedRow {
    id: string;
    cost_code: string | null;
    csi_code: string | null;
    quantity: number | null;
    labor_cost: number | null;
    material_cost: number | null;
    equipment_cost: number | null;
    unit_cost: number | null;
  }
  const unpriced = ((rows ?? []) as UnpricedRow[]).filter((row) => isUnpricedDraftLine(row));
  const codes = [...new Set(unpriced
    .map((row) => row.cost_code || row.csi_code)
    .filter((code): code is string => typeof code === "string" && code.length > 0))];
  const resolved = codes.length > 0
    ? await resolveCostsBatch(codes.map((cost_code) => ({
      cost_code,
      tenant_id: tenantId,
      region: { state: project?.state ?? undefined, zip: project?.zip_code ?? undefined },
    })))
    : [];
  const byCode = new Map(resolved.map((row) => [row.cost_code, row]));

  let priced = 0;
  let stillUnpriced = 0;
  for (const row of unpriced) {
    const code = row.cost_code || row.csi_code;
    const costs = seedLineCosts(Number(row.quantity ?? 0), null, code ? byCode.get(code) ?? null : null);
    if (costs.pricing_status !== "priced") {
      stillUnpriced += 1;
      continue;
    }
    const calc = calculateItem({
      laborCost: costs.labor_cost,
      materialCost: costs.material_cost,
      equipmentCost: costs.equipment_cost,
      quantity: Number(row.quantity ?? 0),
    });
    const { error } = await db.from("estimate_items").update({
      unit_cost: costs.unit_cost,
      labor_cost: costs.labor_cost,
      material_cost: costs.material_cost,
      equipment_cost: costs.equipment_cost,
      total_direct_cost: calc.totalDirectCost,
      total_price: calc.totalPrice,
      unit_price: calc.unitPrice,
      pricing_status: costs.pricing_status,
      updated_by: userId,
    }).eq("id", row.id).eq("estimate_version_id", versionId).eq("tenant_id", tenantId);
    if (!error) priced += 1;
  }

  return NextResponse.json({ priced, still_unpriced: stillUnpriced, considered: unpriced.length });
}
