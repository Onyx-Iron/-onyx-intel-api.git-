import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * Area Bounds takeoff — site clearing / stripping / paving / flatwork
 * boundary polygons drawn on the sheet canvas ("civil_area_bounds" tool).
 *
 * GET    ?project_id=&page_id=  → list boundaries for the given scope.
 * POST   { items: [...] }        → bulk insert (area_sf/excavation_volume_cy
 *                                   are trusted from the client here since
 *                                   they're pure geometry math, same pattern
 *                                   as manual_takeoffs' quantity field).
 * DELETE ?id=                    → delete one boundary.
 */

const BOUNDARY_KINDS = new Set(["topsoil_stripping", "building_pad", "asphalt_paving", "concrete_flatwork"]);
const COST_CODE_RE = /^\d{2}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  const pageId    = req.nextUrl.searchParams.get("page_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
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

interface AreaBoundItem {
  project_id: string;
  page_id?: string | null;
  boundary_kind: string;
  area_sf: number;
  stripping_depth_in?: number | null;
  excavation_volume_cy?: number | null;
  target_cost_code?: string | null;
  boundary_geometry: unknown;
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
    if (typeof it.area_sf !== "number" || !Number.isFinite(it.area_sf) || it.area_sf <= 0) return NextResponse.json({ error: "area_sf must be > 0" }, { status: 400 });
    if (it.target_cost_code && !COST_CODE_RE.test(it.target_cost_code)) return NextResponse.json({ error: `target_cost_code must be NN-NN-NN, got "${it.target_cost_code}"` }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  const rows = items.map((it) => ({
    tenant_id: tenantId,
    project_id: it.project_id,
    page_id: it.page_id ?? null,
    boundary_kind: it.boundary_kind,
    area_sf: it.area_sf,
    stripping_depth_in: it.stripping_depth_in ?? 6,
    excavation_volume_cy: it.excavation_volume_cy ?? null,
    target_cost_code: it.target_cost_code ?? null,
    boundary_geometry: it.boundary_geometry,
    created_by: userId,
    created_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from("civil_area_limits").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inserted: rows.length, ids: (data ?? []).map((d: { id: string }) => d.id) });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from("civil_area_limits")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
