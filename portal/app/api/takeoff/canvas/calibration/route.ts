import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant, assertPageBelongsToProject } from "@/lib/project-controls/server";
import type { CalibrationPoint, CalibrationUpsertBody } from "@/lib/types/takeoff";
import { previewRecalibration, recalibrationNeedsConfirm } from "@/lib/takeoff/recalibration";
import { applyManualScale, type ScaleRegion } from "@/lib/takeoff/stated-scale";
import { requirePermission } from "@/lib/project-controls/route-guards";

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

type UpsertBody = CalibrationUpsertBody;

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

  const { data: regions } = await (db as any)
    .from("sheet_scale_regions")
    .select("id, page_id, scale_text, page_space_scale_factor, min_x, min_y, max_x, max_y, covers_page, anchor_x, anchor_y, source, verified, status, active")
    .eq("tenant_id", tenantId)
    .eq("page_id", pageId)
    .eq("active", true);

  return NextResponse.json({ calibration: data ?? null, regions: regions ?? [] });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as UpsertBody;
  const { project_id, page_id, point_a, point_b, known_distance, known_unit } = body;

  if (!project_id || !page_id) {
    return NextResponse.json({ error: "project_id and page_id required" }, { status: 400 });
  }
  const validPoint = (p: unknown): p is CalibrationPoint => typeof p === "object" && p !== null
    && typeof (p as CalibrationPoint).x === "number" && Number.isFinite((p as CalibrationPoint).x)
    && typeof (p as CalibrationPoint).y === "number" && Number.isFinite((p as CalibrationPoint).y);
  if (!validPoint(point_a) || !validPoint(point_b)) {
    return NextResponse.json({ error: "point_a and point_b (page-space {x,y}) required" }, { status: 400 });
  }
  if (typeof known_distance !== "number" || !Number.isFinite(known_distance) || known_distance <= 0) {
    return NextResponse.json({ error: "known_distance must be a positive number" }, { status: 400 });
  }
  const unit_type = (known_unit ?? "LF").trim().toUpperCase();

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

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

  const oldFactor = typeof before?.page_space_scale_factor === "number" ? before.page_space_scale_factor : null;
  const oldVerified = before?.status === "verified" && oldFactor != null && oldFactor > 0;
  const { data: drafts } = oldVerified
    ? await anyDb
      .from("manual_takeoffs")
      .select("id, label, takeoff_type, quantity, unit, geometry, cost_code, row_version")
      .eq("tenant_id", tenantId)
      .eq("page_id", page_id)
      .is("deleted_at", null)
    : { data: [] as Array<Record<string, unknown>> };
  const preview = previewRecalibration(
    ((drafts ?? []) as Array<{ id: string; label?: string | null; takeoff_type: string; quantity: number; unit?: string | null }>).map((row) => ({
      id: row.id,
      label: row.label,
      takeoff_type: row.takeoff_type,
      quantity: Number(row.quantity),
      unit: row.unit,
    })),
    oldVerified ? oldFactor : null,
    pageSpaceScaleFactor,
  );
  if (oldVerified && recalibrationNeedsConfirm(preview) && body.apply_to_drafts !== true) {
    return NextResponse.json({
      error: "Confirm the before and after quantities before this scale change is saved.",
      requires_confirmation: true,
      preview,
    }, { status: 409 });
  }

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

  const midpoint = { x: (point_a.x + point_b.x) / 2, y: (point_a.y + point_b.y) / 2 };
  const { data: existingRegions } = await anyDb
    .from("sheet_scale_regions")
    .select("scale_text, page_space_scale_factor, min_x, min_y, max_x, max_y, covers_page, anchor_x, anchor_y, source, verified")
    .eq("tenant_id", tenantId)
    .eq("page_id", page_id)
    .eq("active", true);
  const current = ((existingRegions ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const factor = Number(row.page_space_scale_factor);
    if (!Number.isFinite(factor) || factor <= 0) return [];
    const minX = Number(row.min_x);
    const minY = Number(row.min_y);
    const maxX = Number(row.max_x);
    const maxY = Number(row.max_y);
    const hasBounds = [minX, minY, maxX, maxY].every((value) => Number.isFinite(value));
    const region: ScaleRegion = {
      scaleText: String(row.scale_text ?? ""),
      pageSpaceScaleFactor: factor,
      bounds: hasBounds
        ? { minX, minY, maxX, maxY }
        : { minX: 0, minY: 0, maxX: Math.max(point_a.x, point_b.x, 1), maxY: Math.max(point_a.y, point_b.y, 1) },
      coversPage: row.covers_page === true || !hasBounds,
      anchorX: Number(row.anchor_x) || midpoint.x,
      anchorY: Number(row.anchor_y) || midpoint.y,
      source: row.source === "manual" ? "manual" : "stated_on_sheet",
      verified: row.verified === true,
    };
    return [region];
  });
  const pageBox = {
    width: Math.max(1, ...current.map((region) => region.bounds.maxX), point_a.x, point_b.x),
    height: Math.max(1, ...current.map((region) => region.bounds.maxY), point_a.y, point_b.y),
  };
  const nextRegions = applyManualScale(
    current,
    midpoint,
    pageSpaceScaleFactor,
    `${known_distance} ${unit_type}`,
    pageBox,
  );
  await anyDb.from("sheet_scale_regions").update({ active: false, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("page_id", page_id)
    .eq("active", true);
  if (nextRegions.length > 0) {
    const { error: regionError } = await anyDb.from("sheet_scale_regions").insert(nextRegions.map((region) => ({
      tenant_id: tenantId,
      project_id,
      page_id,
      scale_text: region.scaleText,
      page_space_scale_factor: region.pageSpaceScaleFactor,
      min_x: region.bounds.minX,
      min_y: region.bounds.minY,
      max_x: region.bounds.maxX,
      max_y: region.bounds.maxY,
      covers_page: region.coversPage,
      anchor_x: region.anchorX,
      anchor_y: region.anchorY,
      source: region.source,
      verified: region.verified,
      status: region.verified ? "verified" : "stated",
      active: true,
    })));
    if (regionError) return NextResponse.json({ error: regionError.message }, { status: 500 });
  }

  if (body.apply_to_drafts === true) {
    const draftRows = (drafts ?? []) as Array<{ id: string; geometry: unknown; unit?: string | null; cost_code?: string | null; row_version?: number }>;
    for (const line of preview) {
      if (!line.recomputed) continue;
      const row = draftRows.find((candidate) => candidate.id === line.id);
      if (!row || typeof row.row_version !== "number") continue;
      await anyDb.rpc("update_manual_takeoff_tx", {
        p_id: row.id,
        p_tenant_id: tenantId,
        p_expected_row_version: row.row_version,
        p_geometry: row.geometry ?? {},
        p_quantity: line.after,
        p_unit: row.unit ?? null,
        p_cost_code: row.cost_code ?? null,
        p_actor_user_id: userId,
        p_calculation_formula_version: "recalibration-v1",
      });
    }
  }

  return NextResponse.json({ calibration: data, preview });
}
