import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
  assertPageBelongsToProject,
} from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditInsert, auditDelete } from "@/lib/audit";
import { calculatePolygonArea } from "@/lib/takeoff/canvas/quantity";
import type { Point } from "@/lib/takeoff/canvas/coordinates";
import type { AreaBoundItem } from "@/lib/types/takeoff";

export const runtime = "nodejs";

/**
 * Area Bounds takeoff — site clearing / stripping / paving / flatwork
 * boundary polygons drawn on the sheet canvas ("civil_area_bounds" tool).
 *
 * GET    ?project_id=&page_id=  → list boundaries for the given scope.
 * POST   { items: [...] }        → bulk insert. When a verified page-space
 *                                   calibration exists, area_sf / excavation
 *                                   volume are recomputed server-side from
 *                                   polygon geometry (client values ignored).
 * DELETE ?id=                    → delete one boundary.
 */

const BOUNDARY_KINDS = new Set(["topsoil_stripping", "building_pad", "asphalt_paving", "concrete_flatwork"]);
const COST_CODE_RE = /^\d{2}-\d{2}-\d{2}$/;

function extractPoints(geometry: unknown): Point[] | null {
  if (!geometry || typeof geometry !== "object") return null;
  const points = (geometry as { points?: unknown }).points;
  if (!Array.isArray(points) || points.length < 3) return null;
  const out: Point[] = [];
  for (const p of points) {
    if (!p || typeof p !== "object") return null;
    const x = (p as { x?: unknown }).x;
    const y = (p as { y?: unknown }).y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    out.push({ x, y });
  }
  return out;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  const pageId    = req.nextUrl.searchParams.get("page_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
  } catch {
    return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (db as any)
    .from("civil_area_limits")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  if (pageId) query = query.eq("page_id", pageId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { items?: AreaBoundItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  for (const it of items) {
    if (!it.project_id) return NextResponse.json({ error: "each item needs project_id" }, { status: 400 });
    if (!BOUNDARY_KINDS.has(it.boundary_kind)) return NextResponse.json({ error: `invalid boundary_kind: ${it.boundary_kind}` }, { status: 400 });
    if (typeof it.area_sf !== "number" || !Number.isFinite(it.area_sf) || it.area_sf <= 0) {
      return NextResponse.json({ error: "area_sf must be > 0" }, { status: 400 });
    }
    if (it.target_cost_code && !COST_CODE_RE.test(it.target_cost_code)) {
      return NextResponse.json({ error: `target_cost_code must be NN-NN-NN, got "${it.target_cost_code}"` }, { status: 400 });
    }
    if (!extractPoints(it.boundary_geometry)) {
      return NextResponse.json({ error: "boundary_geometry.points must be an array of >=3 {x,y} points" }, { status: 400 });
    }
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const distinctProjectIds = [...new Set(items.map((it) => it.project_id))];
  for (const pid of distinctProjectIds) {
    try {
      await assertProjectBelongsToTenant(pid, tenantId);
    } catch {
      return NextResponse.json({ error: `project_id ${pid} does not belong to this tenant` }, { status: 403 });
    }
  }
  const pagePairs = [...new Map(
    items.filter((it) => it.page_id).map((it) => [`${it.page_id}::${it.project_id}`, { pageId: it.page_id as string, projectId: it.project_id }]),
  ).values()];
  for (const { pageId, projectId } of pagePairs) {
    try {
      await assertPageBelongsToProject(pageId, projectId, tenantId);
    } catch {
      return NextResponse.json({ error: `page_id ${pageId} does not belong to project ${projectId}` }, { status: 403 });
    }
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const distinctPageIds = [...new Set(items.map((it) => it.page_id).filter((p): p is string => Boolean(p)))];
  const calibrationByPageId = new Map<string, { page_space_scale_factor: number | null; status: string }>();
  if (distinctPageIds.length > 0) {
    const { data: calibrations } = await anyDb
      .from("sheet_calibrations")
      .select("page_id, page_space_scale_factor, status")
      .eq("tenant_id", tenantId)
      .in("page_id", distinctPageIds);
    for (const c of calibrations ?? []) calibrationByPageId.set(c.page_id, c);
  }

  const rows = items.map((it) => {
    const points = extractPoints(it.boundary_geometry)!;
    const depthIn = it.stripping_depth_in ?? 6;
    let areaSf = it.area_sf;
    let excavationVolumeCy = it.excavation_volume_cy ?? null;

    const calibration = it.page_id ? calibrationByPageId.get(it.page_id) : undefined;
    const scale = calibration?.page_space_scale_factor;
    if (calibration?.status === "verified" && typeof scale === "number" && scale > 0) {
      // Authoritative: ignore client area/volume when verified calibration exists.
      areaSf = calculatePolygonArea(points, scale);
      excavationVolumeCy = (areaSf * (depthIn / 12)) / 27;
    }

    return {
      tenant_id: tenantId,
      project_id: it.project_id,
      page_id: it.page_id ?? null,
      boundary_kind: it.boundary_kind,
      area_sf: areaSf,
      stripping_depth_in: depthIn,
      excavation_volume_cy: excavationVolumeCy,
      target_cost_code: it.target_cost_code ?? null,
      boundary_geometry: it.boundary_geometry,
      created_by: userId,
      created_at: new Date().toISOString(),
    };
  });

  const { data, error } = await anyDb.from("civil_area_limits").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const row of data ?? []) {
    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "civil_area_limits",
      record_id: row.id,
      new_values: { project_id: items[0]?.project_id },
    });
  }

  return NextResponse.json({ ok: true, inserted: rows.length, ids: (data ?? []).map((d: { id: string }) => d.id) });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: before } = await anyDb
    .from("civil_area_limits")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { error } = await anyDb
    .from("civil_area_limits")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditDelete({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "civil_area_limits",
    record_id: id,
    old_values: (before ?? null) as Record<string, unknown> | null,
  });

  return NextResponse.json({ ok: true });
}
