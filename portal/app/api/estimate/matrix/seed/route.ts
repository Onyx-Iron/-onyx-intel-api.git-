import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * POST /api/estimate/matrix/seed { project_id }
 *
 * Populates `project_estimates` from existing rows in:
 *   - takeoff_items       (deterministic / AI-parsed rows)
 *   - manual_takeoffs     (Sheet Canvas measurements)
 *
 * Idempotent: skips items whose `takeoff_id` already exists in project_estimates.
 * Returns { added, skipped }.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { project_id?: string };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: existing } = await anyDb
    .from("project_estimates")
    .select("takeoff_id")
    .eq("tenant_id", tenantId).eq("project_id", body.project_id);
  const seen = new Set<string>(
    (existing ?? []).map((r: { takeoff_id: string | null }) => r.takeoff_id).filter(Boolean),
  );

  const toInsert: Record<string, unknown>[] = [];

  const { data: takeoffs } = await anyDb
    .from("takeoff_items")
    .select("id, cost_code, description, quantity_basis, total_qty, uom, estimated_unit_cost")
    .eq("tenant_id", tenantId).eq("project_id", body.project_id);
  for (const t of takeoffs ?? []) {
    if (seen.has(t.id)) continue;
    const unitCost = Number(t.estimated_unit_cost ?? 0);
    toInsert.push({
      tenant_id: tenantId,
      project_id: body.project_id,
      takeoff_id: t.id,
      source: "takeoff",
      cost_code: t.cost_code,
      description: t.description,
      quantity: Number(t.total_qty ?? 0),
      unit: t.uom ?? null,
      labor_unit:    +(unitCost * 0.40).toFixed(4),
      material_unit: +(unitCost * 0.45).toFixed(4),
      equipment_unit: +(unitCost * 0.15).toFixed(4),
    });
  }

  const { data: manual } = await anyDb
    .from("manual_takeoffs")
    .select("id, cost_code, takeoff_type, quantity, unit")
    .eq("tenant_id", tenantId).eq("project_id", body.project_id);
  for (const m of manual ?? []) {
    if (seen.has(m.id)) continue;
    toInsert.push({
      tenant_id: tenantId,
      project_id: body.project_id,
      takeoff_id: m.id,
      source: "manual",
      cost_code: m.cost_code,
      description: `Manual ${m.takeoff_type}`,
      quantity: Number(m.quantity ?? 0),
      unit: m.unit,
      labor_unit: 0,
      material_unit: 0,
      equipment_unit: 0,
    });
  }

  let added = 0;
  if (toInsert.length > 0) {
    const { data, error } = await anyDb.from("project_estimates").insert(toInsert).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    added = data?.length ?? toInsert.length;
  }

  return NextResponse.json({ added, skipped: seen.size });
}
