import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { calcPipeEmbedment } from "@/lib/math/civil-scope";
import { utilityRecipeLines } from "@/lib/math/scope-recipes";
import { logEvent } from "@/lib/activity";
import { mirrorCivilItemsToTakeoff, type CivilMirrorRow } from "@/lib/estimating/civil-mirror";

export const runtime = "nodejs";

/**
 * Linear utility (pipe run) takeoff persistence — the Sheet Canvas
 * "utility_pipe" tool. Distinct from `/api/takeoff/canvas/manual` because
 * each run carries trench engineering inputs and a computed excavation
 * yield, not just a quantity/unit pair.
 *
 * GET  ?project_id=&page_id=  → list runs for the given scope.
 * POST { items: [...] }        → bulk insert, computing trench volumes server-side.
 * DELETE ?id=                  → delete one run.
 */

const COST_CODE_RE = /^\d{2}-\d{2}-\d{2}$/;
const SYSTEM_TYPES = new Set(["Sanitary Sewer", "Storm Drain", "Water Line", "Fire Line"]);
const GRAVITY_SYSTEMS = new Set(["Sanitary Sewer", "Storm Drain"]);

// Trench cover isn't captured by the input modal (only inverts, diameter,
// trench width) — the canvas has no surface/rim elevation to derive actual
// cover from invert data. We use a standard frost-depth bury cover as the
// working assumption; the resulting embedment volumes reflect that.
const DEFAULT_COVER_FT = 4;

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
    .from("civil_utility_takeoffs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  if (pageId) query = query.eq("page_id", pageId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

interface UtilityRunItem {
  project_id: string;
  page_id?: string | null;
  cost_code?: string | null;
  system_type: string;
  pipe_diameter_in: number;
  invert_elevation_start: number;
  invert_elevation_end: number;
  trench_width_ft: number;
  run_length_lf: number;
  geometry: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { items?: UtilityRunItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  for (const it of items) {
    if (!it.project_id) return NextResponse.json({ error: "each item needs project_id" }, { status: 400 });
    if (!SYSTEM_TYPES.has(it.system_type)) return NextResponse.json({ error: `invalid system_type: ${it.system_type}` }, { status: 400 });
    if (!Number.isFinite(it.pipe_diameter_in) || it.pipe_diameter_in <= 0) return NextResponse.json({ error: "pipe_diameter_in must be > 0" }, { status: 400 });
    if (!Number.isFinite(it.trench_width_ft) || it.trench_width_ft <= 0) return NextResponse.json({ error: "trench_width_ft must be > 0" }, { status: 400 });
    if (!Number.isFinite(it.run_length_lf) || it.run_length_lf <= 0) return NextResponse.json({ error: "run_length_lf must be > 0" }, { status: 400 });
    if (it.cost_code && !COST_CODE_RE.test(it.cost_code)) return NextResponse.json({ error: `cost_code must be NN-NN-NN, got "${it.cost_code}"` }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const distinctProjectIds = [...new Set(items.map((it) => it.project_id))];
  for (const pid of distinctProjectIds) {
    try {
      await assertProjectBelongsToTenant(pid, tenantId);
    } catch {
      return NextResponse.json({ error: `project_id ${pid} does not belong to this tenant` }, { status: 403 });
    }
  }
  const db = await createServiceClient();

  const rows = items.map((it) => {
    const embedment = calcPipeEmbedment({
      length_lf: it.run_length_lf,
      diameter_in: it.pipe_diameter_in,
      trench_width_ft: it.trench_width_ft,
      avg_depth_ft: DEFAULT_COVER_FT,
    });
    return {
      tenant_id: tenantId,
      project_id: it.project_id,
      page_id: it.page_id ?? null,
      cost_code: it.cost_code ?? null,
      utility_type: GRAVITY_SYSTEMS.has(it.system_type) ? "gravity" : "pressure",
      system_type: it.system_type,
      invert_elevation_start: it.invert_elevation_start,
      invert_elevation_end: it.invert_elevation_end,
      pipe_diameter_in: Math.round(it.pipe_diameter_in),
      trench_width_ft: it.trench_width_ft,
      run_length_lf: Number(it.run_length_lf.toFixed(2)),
      computed_trench_json: embedment,
      geometry: it.geometry,
      created_by: userId,
      created_at: new Date().toISOString(),
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data, error } = await anyDb.from("civil_utility_takeoffs").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const projectId = items[0].project_id;

  // Mirror into takeoff_items so pipe runs feed the estimate — this table
  // exists to carry trench-engineering inputs an estimate line can't hold,
  // but the computed excavation/pipe quantities themselves need to reach
  // pricing the same way any other takeoff finding does.
  const takeoffRows: CivilMirrorRow[] = rows.flatMap((r) =>
    utilityRecipeLines({
      name: r.system_type,
      system: r.system_type,
      diameter_in: r.pipe_diameter_in,
      length_lf: r.run_length_lf,
      embedment: r.computed_trench_json,
      pipe_csi: r.cost_code,
    }).map((line) => ({ ...line, drawing_ref: null })),
  );
  await mirrorCivilItemsToTakeoff(anyDb, tenantId, projectId, items[0].page_id ?? null, "civil_utility_takeoffs", (data?.[0]?.id as string) ?? "", takeoffRows, userId);

  void logEvent({
    projectId,
    tenantId,
    userId,
    entityType: "takeoff",
    entityId: (data?.[0]?.id as string) ?? projectId,
    action: "created",
    title: `Utility takeoff: ${items.length} pipe run${items.length === 1 ? "" : "s"} saved`,
    meta: { count: items.length },
  });

  return NextResponse.json({
    ok: true,
    inserted: rows.length,
    ids: (data ?? []).map((d: { id: string }) => d.id),
    trench: rows.map((r) => r.computed_trench_json),
  });
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
    .from("civil_utility_takeoffs")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
