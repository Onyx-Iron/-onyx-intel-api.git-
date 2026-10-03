import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { logEvent } from "@/lib/activity";
import { mirrorCivilItemsToTakeoff, type CivilMirrorRow } from "@/lib/estimating/civil-mirror";
import { REBAR_UNIT_WEIGHT_LBS_PER_FT, type RebarSize } from "@/lib/math/assemblies";
import { wallRecipeLines } from "@/lib/math/scope-recipes";

export const runtime = "nodejs";

const REBAR_SIZES = new Set(Object.keys(REBAR_UNIT_WEIGHT_LBS_PER_FT));

/**
 * Drawn wall recipe. The centerline length is measured on the sheet.
 * Height and thickness come from the estimator. Concrete, formwork, and
 * rebar quantities are recomputed here from those inputs.
 */

interface WallItem {
  project_id: string;
  page_id?: string | null;
  length_lf: number;
  height_ft: number;
  thickness_in: number;
  rebar_size?: string | null;
  rebar_spacing_inches?: number | null;
  geometry?: unknown;
  client_key?: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (db as any)
    .from("takeoff_items")
    .select("id, quantity, unit, meta, sheet_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("csi_code", "03-30-00")
    .contains("meta", { civil_source_table: "canvas_wall_recipes", recipe_part: "concrete" });
  if (pageId) query = query.eq("sheet_id", pageId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    items: (data ?? []).map((row: { id: string; meta?: Record<string, unknown> | null }) => ({
      id: row.id,
      client_key: row.meta?.client_key ?? null,
      length_lf: row.meta?.length_lf ?? null,
      height_ft: row.meta?.height_ft ?? null,
      thickness_in: row.meta?.thickness_in ?? null,
      rebar_size: row.meta?.rebar_size ?? null,
      rebar_spacing_inches: row.meta?.rebar_spacing_inches ?? null,
      geometry: row.meta?.geometry ?? null,
    })),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { items?: WallItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  for (const it of items) {
    if (!it.project_id) return NextResponse.json({ error: "each item needs project_id" }, { status: 400 });
    if (!Number.isFinite(it.length_lf) || it.length_lf <= 0) return NextResponse.json({ error: "length_lf must be > 0" }, { status: 400 });
    if (!Number.isFinite(it.height_ft) || it.height_ft <= 0) return NextResponse.json({ error: "height_ft must be > 0" }, { status: 400 });
    if (!Number.isFinite(it.thickness_in) || it.thickness_in <= 0) return NextResponse.json({ error: "thickness_in must be > 0" }, { status: 400 });
    if (it.rebar_size && !REBAR_SIZES.has(it.rebar_size)) return NextResponse.json({ error: `invalid rebar_size: ${it.rebar_size}` }, { status: 400 });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const projectId = items[0].project_id;
  const recipes = items.map((it) => {
    const rebarSize = it.rebar_size ? it.rebar_size as RebarSize : undefined;
    const spacing = it.rebar_spacing_inches && it.rebar_spacing_inches > 0 ? it.rebar_spacing_inches : undefined;
    return {
      item: it,
      lines: wallRecipeLines({
        name: "Wall",
        length_lf: it.length_lf,
        height_ft: it.height_ft,
        thickness_in: it.thickness_in,
        rebar_size: spacing ? rebarSize : undefined,
        rebar_spacing_inches: spacing,
      }),
    };
  });

  const sourceId = items[0].client_key || crypto.randomUUID();
  const takeoffRows: CivilMirrorRow[] = recipes.flatMap(({ item, lines }) =>
    lines.map((line) => ({
      ...line,
      drawing_ref: null,
      meta: {
        recipe_part: line.csi_code === "03-30-00" ? "concrete" : line.csi_code === "03-11-00" ? "formwork" : "rebar",
        client_key: item.client_key ?? null,
        length_lf: item.length_lf,
        height_ft: item.height_ft,
        thickness_in: item.thickness_in,
        rebar_size: item.rebar_size ?? null,
        rebar_spacing_inches: item.rebar_spacing_inches ?? null,
        geometry: line.csi_code === "03-30-00" ? item.geometry ?? null : null,
      },
    })),
  );

  await mirrorCivilItemsToTakeoff(
    anyDb,
    tenantId,
    projectId,
    items[0].page_id ?? null,
    "canvas_wall_recipes",
    sourceId,
    takeoffRows,
    userId,
  );

  void logEvent({
    projectId,
    tenantId,
    userId,
    entityType: "takeoff",
    entityId: sourceId,
    action: "created",
    title: `Wall recipe: ${items.length} wall${items.length === 1 ? "" : "s"} saved`,
    meta: { count: items.length, lines: takeoffRows.length },
  });

  return NextResponse.json({
    ok: true,
    inserted: items.length,
    lines: takeoffRows.map((row) => ({ label: row.label, csi_code: row.csi_code, quantity: row.quantity, unit: row.unit })),
  });
}
