import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant, assertPageBelongsToProject } from "@/lib/project-controls/server";
import { hasPermission } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

/**
 * Sheet calibration — page-space model (manual-takeoff-calibration-hardening
 * milestone). See docs/milestones/manual-takeoff-calibration-hardening/
 * TARGET_CALIBRATION_MODEL.md.
 *
 * GET  ?page_id=... → returns current calibration (or null). Includes
 *      `status` ('verified' | 'legacy_render_space' | 'needs_verification')
 *      so the client can show a clear verified/unverified indicator and
 *      gate new-approval / estimate-sync behavior on it.
 * PUT  { project_id, page_id, point_a: {x,y}, point_b: {x,y}, known_distance, known_unit }
 *      → point_a/point_b MUST already be in PAGE SPACE (the client converts
 *      current-render pixels via toPageSpace(pt, renderScale) before
 *      calling this route — see SheetCanvas.tsx's finishCalibration). The
 *      server recomputes page_space_scale_factor from these page-space
 *      points itself; it never trusts a client-submitted factor.
 */

interface Pt { x: number; y: number }

interface UpsertBody {
  project_id?: string;
  page_id?: string;
  point_a?: Pt;
  point_b?: Pt;
  known_distance?: number;
  known_unit?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("sheet_calibrations")
    .select("id, page_id, project_id, scale_ratio, unit_type, point_a_x, point_a_y, point_b_x, point_b_y, known_distance, known_unit, page_space_scale_factor, coordinate_system_version, status, verified, active, created_by, updated_at")
    .eq("tenant_id", tenantId)
    .eq("page_id", pageId)
    .maybeSingle();

  return NextResponse.json({ calibration: data ?? null });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as UpsertBody;
  const { project_id, page_id, point_a, point_b, known_distance, known_unit } = body;

  if (!project_id || !page_id) {
    return NextResponse.json({ error: "project_id and page_id required" }, { status: 400 });
  }
  const validPoint = (p: unknown): p is Pt => typeof p === "object" && p !== null
    && typeof (p as Pt).x === "number" && Number.isFinite((p as Pt).x)
    && typeof (p as Pt).y === "number" && Number.isFinite((p as Pt).y);
  if (!validPoint(point_a) || !validPoint(point_b)) {
    return NextResponse.json({ error: "point_a and point_b (page-space {x,y}) required" }, { status: 400 });
  }
  if (typeof known_distance !== "number" || !Number.isFinite(known_distance) || known_distance <= 0) {
    return NextResponse.json({ error: "known_distance must be a positive number" }, { status: 400 });
  }
  const unit_type = (known_unit ?? "LF").trim().toUpperCase();

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  if (!(await hasPermission(tenantId, userId, "field", "write"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await assertProjectBelongsToTenant(project_id, tenantId);
    await assertPageBelongsToProject(page_id, project_id, tenantId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "ownership check failed" }, { status: 403 });
  }

  // Authoritative computation: the page-space distance between the two
  // page-space points the client submitted, never a client-submitted ratio.
  const pageSpaceDistance = Math.hypot(point_b.x - point_a.x, point_b.y - point_a.y);
  if (pageSpaceDistance <= 0) {
    return NextResponse.json({ error: "point_a and point_b must be distinct points" }, { status: 400 });
  }
  const pageSpaceScaleFactor = known_distance / pageSpaceDistance;

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: before } = await anyDb
    .from("sheet_calibrations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("page_id", page_id)
    .maybeSingle();

  const { data, error } = await anyDb
    .from("sheet_calibrations")
    .upsert(
      {
        tenant_id: tenantId,
        project_id,
        page_id,
        unit_type,
        point_a_x: point_a.x, point_a_y: point_a.y,
        point_b_x: point_b.x, point_b_y: point_b.y,
        known_distance,
        known_unit: unit_type,
        page_space_scale_factor: pageSpaceScaleFactor,
        coordinate_system_version: "v1",
        status: "verified",
        verified: true,
        active: true,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "page_id" },
    )
    .select("id, page_id, project_id, scale_ratio, unit_type, point_a_x, point_a_y, point_b_x, point_b_y, known_distance, known_unit, page_space_scale_factor, coordinate_system_version, status, verified, active, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await anyDb.from("sheet_calibration_history").insert({
    tenant_id: tenantId, project_id, calibration_id: data.id,
    action: before ? "recalibrated" : "created",
    actor_user_id: userId, before: before ?? null, after: data,
  });

  return NextResponse.json({ calibration: data });
}
