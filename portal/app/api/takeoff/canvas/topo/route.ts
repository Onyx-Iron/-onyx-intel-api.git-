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
import type { TopoNodeItem } from "@/lib/types/takeoff";

export const runtime = "nodejs";

/**
 * Topographic contour lines + spot elevations — the Sheet Canvas
 * "contour_line" / "spot_elevation" tools (manual or auto-matched from
 * C-TOPO / PGCONT CAD layers).
 *
 * GET    ?project_id=&page_id=  → list nodes for the given scope.
 * POST   { items: [...] }        → bulk insert.
 * DELETE ?id=                    → delete one node.
 */

const NODE_TYPES = new Set(["contour_line", "spot_elevation"]);

function isValidGeometry(geometry: unknown): boolean {
  if (!geometry || typeof geometry !== "object") return false;
  const g = geometry as { points?: unknown; type?: unknown };
  if (Array.isArray(g.points)) {
    return g.points.every(
      (p) =>
        p
        && typeof p === "object"
        && typeof (p as { x?: unknown }).x === "number"
        && typeof (p as { y?: unknown }).y === "number"
        && Number.isFinite((p as { x: number }).x)
        && Number.isFinite((p as { y: number }).y),
    );
  }
  // Spot elevations may carry a single coordinate pair.
  const x = (geometry as { x?: unknown }).x;
  const y = (geometry as { y?: unknown }).y;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
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
    .from("canvas_topo_nodes")
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

  const body = await req.json().catch(() => ({})) as { items?: TopoNodeItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  for (const it of items) {
    if (!it.project_id || !it.page_id) return NextResponse.json({ error: "each item needs project_id and page_id" }, { status: 400 });
    if (!NODE_TYPES.has(it.node_type)) return NextResponse.json({ error: `invalid node_type: ${it.node_type}` }, { status: 400 });
    if (typeof it.elevation !== "number" || !Number.isFinite(it.elevation)) return NextResponse.json({ error: "elevation must be a number" }, { status: 400 });
    if (!isValidGeometry(it.geometry)) return NextResponse.json({ error: "geometry must include numeric points or x/y" }, { status: 400 });
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
    items.map((it) => [`${it.page_id}::${it.project_id}`, { pageId: it.page_id, projectId: it.project_id }]),
  ).values()];
  for (const { pageId, projectId } of pagePairs) {
    try {
      await assertPageBelongsToProject(pageId, projectId, tenantId);
    } catch {
      return NextResponse.json({ error: `page_id ${pageId} does not belong to project ${projectId}` }, { status: 403 });
    }
  }

  const db = await createServiceClient();

  const rows = items.map((it) => ({
    tenant_id: tenantId,
    project_id: it.project_id,
    page_id: it.page_id,
    node_type: it.node_type,
    elevation: it.elevation,
    geometry: it.geometry,
    layer_assignment: it.layer_assignment ?? "manual",
    created_by: userId,
    created_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from("canvas_topo_nodes").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const row of data ?? []) {
    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "canvas_topo_nodes",
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
    .from("canvas_topo_nodes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { error } = await anyDb
    .from("canvas_topo_nodes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditDelete({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "canvas_topo_nodes",
    record_id: id,
    old_values: (before ?? null) as Record<string, unknown> | null,
  });

  return NextResponse.json({ ok: true });
}
