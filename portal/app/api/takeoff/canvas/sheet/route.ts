import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

const PLANS_BUCKET = "plans-bucket";

/**
 * One signed URL plus the calibration and saved geometry for a sheet.
 * Replaces the six requests SheetCanvas used to make on every open.
 *
 * GET ?project_id=&page_id=
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!projectId || !pageId) {
    return NextResponse.json({ error: "project_id and page_id required" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const [pageResult, calibrationResult, manualResult, utilityResult, topoResult, areaResult] = await Promise.all([
    anyDb.from("document_pages").select("id, storage_path, page_number, document_id").eq("id", pageId).eq("tenant_id", tenantId).single(),
    anyDb.from("sheet_calibrations").select("id, page_id, project_id, scale_ratio, unit_type, point_a_x, point_a_y, point_b_x, point_b_y, known_distance, known_unit, page_space_scale_factor, coordinate_system_version, status, verified, active, created_by, updated_at").eq("tenant_id", tenantId).eq("page_id", pageId).maybeSingle(),
    anyDb.from("manual_takeoffs").select("*").eq("tenant_id", tenantId).eq("project_id", projectId).eq("page_id", pageId).order("created_at", { ascending: false }),
    anyDb.from("civil_utility_takeoffs").select("*").eq("tenant_id", tenantId).eq("project_id", projectId).eq("page_id", pageId).order("created_at", { ascending: false }),
    anyDb.from("canvas_topo_nodes").select("*").eq("tenant_id", tenantId).eq("project_id", projectId).eq("page_id", pageId).order("created_at", { ascending: false }),
    anyDb.from("civil_area_limits").select("*").eq("tenant_id", tenantId).eq("project_id", projectId).eq("page_id", pageId).order("created_at", { ascending: false }),
  ]);

  if (pageResult.error || !pageResult.data) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await db.storage.from(PLANS_BUCKET).createSignedUrl(pageResult.data.storage_path, 60 * 30);
  if (signErr || !signed) {
    return NextResponse.json({ error: `Storage signing failed: ${signErr?.message ?? "unknown"}` }, { status: 500 });
  }

  return NextResponse.json({
    url: signed.signedUrl,
    page_number: pageResult.data.page_number,
    document_id: pageResult.data.document_id,
    calibration: calibrationResult.error ? null : (calibrationResult.data ?? null),
    manual: { items: manualResult.error ? [] : (manualResult.data ?? []) },
    utility: { items: utilityResult.error ? [] : (utilityResult.data ?? []) },
    topo: { items: topoResult.error ? [] : (topoResult.data ?? []) },
    area_bounds: { items: areaResult.error ? [] : (areaResult.data ?? []) },
  });
}
