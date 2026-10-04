import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant, assertPageBelongsToProject,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { polygonSelfIntersects } from "@/lib/takeoff/canvas/quantity";
import { matchScalePreset, pageSpaceFactorForPreset, SCALE_PRESETS } from "@/lib/takeoff/scale-presets";
import type { Point } from "@/lib/takeoff/canvas/coordinates";

export const runtime = "nodejs";

function parsePoints(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  const points: Point[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const x = Number((item as { x?: unknown }).x);
    const y = Number((item as { y?: unknown }).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }
  return points;
}

function confirmedFactor(body: {
  preset_label?: string;
  known_distance?: number;
  known_unit?: string;
  calibration_points?: unknown;
}): { factor: number; known_distance: number | null; known_unit: string } | null {
  if (typeof body.preset_label === "string" && body.preset_label.trim()) {
    const preset = SCALE_PRESETS.find((item) => item.label === body.preset_label)
      ?? matchScalePreset(body.preset_label);
    if (!preset) return null;
    return { factor: pageSpaceFactorForPreset(preset), known_distance: null, known_unit: "ft" };
  }
  const known = Number(body.known_distance);
  const segment = parsePoints(body.calibration_points);
  if (segment.length === 2 && Number.isFinite(known) && known > 0) {
    const length = Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y);
    if (length <= 0) return null;
    const unit = typeof body.known_unit === "string" && body.known_unit.trim() ? body.known_unit.trim() : "ft";
    return { factor: known / length, known_distance: known, known_unit: unit };
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!projectId || !pageId) return NextResponse.json({ error: "project_id and page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try { await assertProjectBelongsToTenant(projectId, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("sheet_scale_regions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("page_id", pageId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ regions: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    id?: string;
    project_id?: string;
    page_id?: string;
    polygon?: unknown;
    label?: string;
    preset_label?: string;
    known_distance?: number;
    known_unit?: string;
    calibration_points?: unknown;
  };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });
  try {
    await assertProjectBelongsToTenant(body.project_id, tenantId);
    if (body.page_id) await assertPageBelongsToProject(body.page_id, body.project_id, tenantId);
  } catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const polygon = body.polygon == null ? null : parsePoints(body.polygon);
  if (polygon && (polygon.length < 3 || polygonSelfIntersects(polygon))) {
    return NextResponse.json({
      error: "This scale region crosses itself, so it is not stored.",
      code: "polygon_rejected",
    }, { status: 422 });
  }

  const confirmed = confirmedFactor(body);
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (db as any).from("sheet_scale_regions");

  if (body.id) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (polygon) patch.polygon = polygon;
    if (typeof body.label === "string") patch.label = body.label.trim() || null;
    if (confirmed) {
      patch.page_space_scale_factor = confirmed.factor;
      patch.known_distance = confirmed.known_distance;
      patch.known_unit = confirmed.known_unit;
      patch.verified = true;
    }
    const { data, error } = await table
      .update(patch)
      .eq("id", body.id)
      .eq("tenant_id", tenantId)
      .eq("project_id", body.project_id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ region: data });
  }

  if (!body.page_id || !polygon) {
    return NextResponse.json({ error: "page_id and polygon required" }, { status: 400 });
  }
  const { data, error } = await table
    .insert({
      tenant_id: tenantId,
      project_id: body.project_id,
      page_id: body.page_id,
      polygon,
      label: typeof body.label === "string" ? body.label.trim() || null : null,
      page_space_scale_factor: confirmed?.factor ?? null,
      verified: confirmed != null,
      known_distance: confirmed?.known_distance ?? null,
      known_unit: confirmed?.known_unit ?? null,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ region: data }, { status: 201 });
}
