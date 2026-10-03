import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditInsert } from "@/lib/audit";
import { compareGrids, applyDeductions, massHaulSummary, type GridSurface, type Deductions, type MaterialFactors } from "@/lib/math/earthwork";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/earthwork/calculate
 * Body:
 *   {
 *     project_id,
 *     layer_name?,                 // defaults to "site_bulk"
 *     existing_surface_id,         // civil_surfaces.id
 *     proposed_surface_id,         // civil_surfaces.id
 *     deductions?,
 *     factors?: { shrink_factor?, swell_factor? },
 *     truck_payload_cy?: 12
 *   }
 * Persists row into earthwork_volumes.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      layer_name?: string;
      existing_surface_id?: string;
      proposed_surface_id?: string;
      deductions?: Deductions;
      factors?: MaterialFactors;
      truck_payload_cy?: number;
    };
    if (!body.project_id || !body.existing_surface_id || !body.proposed_surface_id) {
      return NextResponse.json({ error: "project_id, existing_surface_id, proposed_surface_id required" }, { status: 400 });
    }
    const layerName = body.layer_name ?? "site_bulk";

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    await assertProjectBelongsToTenant(body.project_id, tenantId);
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const [{ data: ex }, { data: pr }] = await Promise.all([
      anyDb.from("civil_surfaces").select("coordinate_mesh").eq("id", body.existing_surface_id).eq("tenant_id", tenantId).single(),
      anyDb.from("civil_surfaces").select("coordinate_mesh").eq("id", body.proposed_surface_id).eq("tenant_id", tenantId).single(),
    ]);
    if (!ex?.coordinate_mesh || !pr?.coordinate_mesh) {
      return NextResponse.json({ error: "surface not found or has no mesh" }, { status: 404 });
    }

    let result;
    try {
      const base = compareGrids(ex.coordinate_mesh as GridSurface, pr.coordinate_mesh as GridSurface);
      result = applyDeductions(base, ex.coordinate_mesh as GridSurface, body.deductions);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }

    const factors: MaterialFactors = {
      shrink_factor: body.factors?.shrink_factor ?? 0.85,
      swell_factor:  body.factors?.swell_factor  ?? 1.15,
    };
    const haul = massHaulSummary(result, factors, body.truck_payload_cy ?? 12);

    const { data: upserted, error } = await anyDb.from("earthwork_volumes").upsert({
      tenant_id: tenantId,
      project_id: body.project_id,
      layer_name: layerName,
      cut_volume_cy:  result.cut_bcy,
      fill_volume_cy: result.fill_bcy,
      net_balance_cy: result.net_bcy,
      shrink_factor:  factors.shrink_factor,
      swell_factor:   factors.swell_factor,
      deductions: body.deductions ?? null,
      metadata: {
        grid_size: (ex.coordinate_mesh as GridSurface).grid_size,
        cells_evaluated: result.cells_evaluated,
        cells_holes: result.cells_holes,
        extents_sf: result.extents_sf,
        method: "grid_composite_block",
        truck_payload_cy: body.truck_payload_cy ?? 12,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id,layer_name" }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "earthwork_volumes",
      record_id: upserted.id,
      new_values: upserted as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ row: upserted, result, haul });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
