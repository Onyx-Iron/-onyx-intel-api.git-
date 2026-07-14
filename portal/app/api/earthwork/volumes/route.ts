import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { massHaulSummary, applyMaterialFactors, type MaterialFactors } from "@/lib/math/earthwork";

export const runtime = "nodejs";

/**
 * GET /api/earthwork/volumes?project_id=
 * Returns all persisted earthwork_volumes rows for the project + a per-row
 * mass-haul summary computed with the row's factors.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // project_id is optional so the global Civil Intelligence workspace can
  // roll up earthwork volumes across every project for the tenant; every
  // project-scoped caller still passes it explicitly.
  const projectId = req.nextUrl.searchParams.get("project_id");

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  let query = anyDb.from("earthwork_volumes")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("layer_name");
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  interface Row {
    id: string; layer_name: string;
    cut_volume_cy: number; fill_volume_cy: number; net_balance_cy: number;
    shrink_factor: number; swell_factor: number;
    deductions: unknown; metadata: unknown; updated_at: string;
  }
  const rows = (data ?? []) as Row[];

  const items = rows.map((r) => {
    const factors: MaterialFactors = { shrink_factor: Number(r.shrink_factor), swell_factor: Number(r.swell_factor) };
    const haul = massHaulSummary({
      cut_bcy: Number(r.cut_volume_cy),
      fill_bcy: Number(r.fill_volume_cy),
      net_bcy: Number(r.net_balance_cy),
      cell_area_sf: 0, cells_evaluated: 0, cells_holes: 0, extents_sf: 0,
      deduction_details: { topsoil_bcy: 0, over_excavation_bcy: 0, select_fill_bcy: 0 },
    }, factors);
    return { ...r, haul };
  });

  // Site-wide roll-up (sum all layers)
  const totals = items.reduce((acc, it) => {
    acc.cut_bcy      += it.haul.cut.bcy;
    acc.fill_bcy     += it.haul.fill.bcy;
    acc.import_bcy   += it.haul.import_bcy;
    acc.export_bcy   += it.haul.export_bcy;
    acc.onsite_bcy   += it.haul.onsite_reuse_bcy;
    acc.truck_import += it.haul.truck_loads_import;
    acc.truck_export += it.haul.truck_loads_export;
    return acc;
  }, { cut_bcy: 0, fill_bcy: 0, import_bcy: 0, export_bcy: 0, onsite_bcy: 0, truck_import: 0, truck_export: 0 });

  const totalsHaul = massHaulSummary({
    cut_bcy: totals.cut_bcy, fill_bcy: totals.fill_bcy, net_bcy: totals.cut_bcy - totals.fill_bcy,
    cell_area_sf: 0, cells_evaluated: 0, cells_holes: 0, extents_sf: 0,
    deduction_details: { topsoil_bcy: 0, over_excavation_bcy: 0, select_fill_bcy: 0 },
  }, { shrink_factor: 0.85, swell_factor: 1.15 });

  return NextResponse.json({
    items,
    totals: {
      ...totals,
      net_bcy: totals.cut_bcy - totals.fill_bcy,
      cut:  applyMaterialFactors(totals.cut_bcy),
      fill: applyMaterialFactors(totals.fill_bcy),
      haul: totalsHaul,
    },
  });
}

/**
 * PATCH { project_id, layer_name?, deduction: { kind, area_sf, depth_in?,
 *         volume_cy, area_limit_id?, source } }
 *
 * "Commit Area to Earthwork" from the Area Bounds canvas tool — appends a
 * localized deduction entry onto the matching layer's `deductions` array
 * (creating the layer row if it doesn't exist yet). Does not mutate
 * cut/fill totals directly; those stay the bulk grid engine's responsibility
 * — this just records the deduction for the mass-haul/audit trail.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    layer_name?: string;
    deduction?: { kind: string; area_sf: number; depth_in?: number; volume_cy: number; area_limit_id?: string; source?: string };
  };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });
  if (!body.deduction || typeof body.deduction.volume_cy !== "number") {
    return NextResponse.json({ error: "deduction { kind, area_sf, volume_cy } required" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const layerName = body.layer_name || "area_bounds_deductions";

  const entry = { ...body.deduction, applied_at: new Date().toISOString() };

  const { data: existing } = await anyDb
    .from("earthwork_volumes")
    .select("id, deductions")
    .eq("tenant_id", tenantId).eq("project_id", body.project_id).eq("layer_name", layerName)
    .maybeSingle();

  if (existing) {
    const nextDeductions = [...(Array.isArray(existing.deductions) ? existing.deductions : []), entry];
    const { error } = await anyDb.from("earthwork_volumes")
      .update({ deductions: nextDeductions, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, layer_id: existing.id, deductions: nextDeductions });
  }

  const { data: created, error } = await anyDb.from("earthwork_volumes").insert({
    tenant_id: tenantId,
    project_id: body.project_id,
    layer_name: layerName,
    cut_volume_cy: 0,
    fill_volume_cy: 0,
    net_balance_cy: 0,
    deductions: [entry],
    scope_type: "area_bounds_deduction",
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, layer_id: created.id, deductions: [entry] });
}
