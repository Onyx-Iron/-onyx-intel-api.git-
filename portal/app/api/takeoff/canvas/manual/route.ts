import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant, assertPageBelongsToProject } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { logEvent } from "@/lib/activity";
import { processOutboxBatch } from "@/lib/estimating/outbox-worker";
import { calculateLinearLength, calculatePolygonArea, calculateCount, FORMULA_VERSION } from "@/lib/takeoff/canvas/quantity";
import type { Point } from "@/lib/takeoff/canvas/coordinates";
import type { ManualTakeoffItem, ManualTakeoffUpdateBody } from "@/lib/types/takeoff";

export const runtime = "nodejs";

/**
 * Manual takeoff persistence (manual-takeoff-calibration-hardening
 * milestone — see docs/milestones/manual-takeoff-calibration-hardening/).
 *
 * GET  ?project_id=&page_id=  → list non-deleted rows for the given scope.
 * POST { items: [{ project_id, page_id?, cost_code?, takeoff_type, quantity, unit?, geometry, client_key? }] }
 *      → each item is saved via the `save_manual_takeoff_tx` Postgres RPC —
 *        upsert + audit history + mirrored takeoff_items upsert + mirror
 *        history + a durable outbox event all happen in ONE database
 *        transaction (STEP 8). Idempotent on (tenant_id, project_id,
 *        client_key) — items without a client_key get a server-generated
 *        one so every save (including older single-item callers like
 *        CADVectorLayer) is atomic, even though only client-originated
 *        retries actually rely on the dedup behavior.
 * DELETE ?id=  → soft-deletes the source AND hard-deletes its mirror in one
 *        transaction via `soft_delete_manual_takeoff_tx` (STEP 9).
 * PUT   { id } → restores a soft-deleted takeoff via `restore_manual_takeoff_tx`
 *        (clears deleted_at, recreates mirror, enqueues estimate sync upsert).
 *
 * Server-side quantity validation (STEP 7): when the page has a VERIFIED
 * page-space calibration, the server recalculates quantity from geometry +
 * calibration itself (lib/takeoff/canvas/quantity.ts) and uses that
 * authoritative value — a manipulated browser-submitted quantity cannot
 * silently persist. When calibration is legacy/unverified, no authoritative
 * recalculation is possible (no page-space scale factor exists yet), so the
 * submitted quantity is trusted as-is and the response carries a warning;
 * this is also when estimate-sync is skipped, per the "unverified
 * calibration cannot approve quantities into the estimate" policy.
 */

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
    .from("manual_takeoffs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (pageId) query = query.eq("page_id", pageId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

type Item = ManualTakeoffItem;

const QUANTITY_TOLERANCE_PCT = 1; // >1% discrepancy between submitted and server-calculated quantity is flagged

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { items?: Item[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  const validTypes = new Set(["count", "length", "area"]);
  for (const it of items) {
    if (!it.project_id) return NextResponse.json({ error: "each item needs project_id" }, { status: 400 });
    if (!validTypes.has(it.takeoff_type)) return NextResponse.json({ error: `invalid takeoff_type: ${it.takeoff_type}` }, { status: 400 });
    if (typeof it.quantity !== "number" || !Number.isFinite(it.quantity)) return NextResponse.json({ error: "quantity must be a number" }, { status: 400 });
    if (it.cost_code && !COST_CODE_RE.test(it.cost_code)) return NextResponse.json({ error: `cost_code must be NN-NN-NN, got "${it.cost_code}"` }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const distinctProjectIds = [...new Set(items.map((it) => it.project_id))];
  for (const pid of distinctProjectIds) {
    try {
      await assertProjectBelongsToTenant(pid, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }
  }

  const distinctPagePairs = [...new Map(
    items.filter((it) => it.page_id).map((it) => [`${it.page_id}::${it.project_id}`, { pageId: it.page_id as string, projectId: it.project_id }]),
  ).values()];
  for (const { pageId, projectId: pid } of distinctPagePairs) {
    try {
      await assertPageBelongsToProject(pageId, pid, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // Resolve each distinct page_id's parent document_id up front (needed for
  // the takeoff_items mirror's own document_id column — see
  // 20260802_atomic_write_document_id_fix.sql) and its calibration (for
  // server-side quantity validation).
  const distinctPageIds = [...new Set(items.map((it) => it.page_id).filter((p): p is string => Boolean(p)))];
  const pageInfoById = new Map<string, { documentId: string }>();
  const calibrationByPageId = new Map<string, { page_space_scale_factor: number | null; status: string }>();
  if (distinctPageIds.length > 0) {
    const [{ data: pages }, { data: calibrations }] = await Promise.all([
      anyDb.from("document_pages").select("id, document_id").in("id", distinctPageIds),
      anyDb.from("sheet_calibrations").select("page_id, page_space_scale_factor, status").eq("tenant_id", tenantId).in("page_id", distinctPageIds),
    ]);
    for (const p of pages ?? []) pageInfoById.set(p.id, { documentId: p.document_id });
    for (const c of calibrations ?? []) calibrationByPageId.set(c.page_id, c);
  }

  const results: Array<{ id: string; client_key: string; was_update: boolean; quantity: number; unit: string; row_version: number; calculation_formula_version: string | null; discrepancy_warning: string | null; calibration_warning: string | null }> = [];
  let anyVerifiedCalibrationUsed = false;
  const projectIdsNeedingSync = new Set<string>();

  for (const it of items) {
    const clientKey = it.client_key ?? crypto.randomUUID();
    const geo = it.geometry ?? {};
    const isVisionSourced = geo.source === "vision_extraction";
    const documentId = it.page_id ? pageInfoById.get(it.page_id)?.documentId ?? null : null;
    const calibration = it.page_id ? calibrationByPageId.get(it.page_id) : undefined;

    let quantity = it.quantity;
    let calculationFormulaVersion: string | null = null;
    let discrepancyWarning: string | null = null;
    let calibrationWarning: string | null = null;

    const isPageSpace = geo.coordinate_space === "page_space" && Array.isArray(geo.points);
    if (calibration?.status === "verified" && calibration.page_space_scale_factor != null && isPageSpace) {
      const points = geo.points as Point[];
      let serverQuantity: number;
      if (it.takeoff_type === "count") serverQuantity = calculateCount(points);
      else if (it.takeoff_type === "length") serverQuantity = calculateLinearLength(points, calibration.page_space_scale_factor);
      else serverQuantity = calculatePolygonArea(points, calibration.page_space_scale_factor);

      const pctDiff = it.quantity !== 0 ? Math.abs(serverQuantity - it.quantity) / Math.abs(it.quantity) * 100 : (serverQuantity === 0 ? 0 : 100);
      if (pctDiff > QUANTITY_TOLERANCE_PCT) {
        discrepancyWarning = `submitted quantity ${it.quantity} differed from server-calculated ${serverQuantity.toFixed(4)} by ${pctDiff.toFixed(1)}% — server value used`;
      }
      quantity = serverQuantity;
      calculationFormulaVersion = FORMULA_VERSION;
      anyVerifiedCalibrationUsed = true;
    } else if (it.page_id) {
      // No verified page-space calibration for this sheet — cannot
      // authoritatively recompute, so the submitted quantity is trusted
      // as-is (STEP 4/18: never fabricate a scale that doesn't exist).
      // Estimate-sync is withheld for this item below until recalibration.
      calibrationWarning = calibration
        ? "this sheet's calibration is legacy/unverified — recalibrate before this measurement can sync to the estimate"
        : "this sheet has no calibration yet — recalibrate before this measurement can sync to the estimate";
    }

    const { data, error } = await anyDb.rpc("save_manual_takeoff_tx", {
      p_tenant_id: tenantId,
      p_project_id: it.project_id,
      p_page_id: it.page_id ?? null,
      p_document_id: documentId,
      p_cost_code: it.cost_code ?? null,
      p_takeoff_type: it.takeoff_type,
      p_quantity: quantity,
      p_unit: it.unit ?? (it.takeoff_type === "count" ? "EA" : it.takeoff_type === "length" ? "LF" : "SF"),
      p_geometry: it.geometry,
      p_client_key: clientKey,
      p_actor_user_id: userId,
      p_calculation_formula_version: calculationFormulaVersion,
      p_is_vision_sourced: isVisionSourced,
      p_label: typeof geo.description === "string" ? geo.description : null,
    }).single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const row = data as { manual_takeoff: { id: string; row_version: number }; mirror_takeoff_item_id: string; was_update: boolean };
    results.push({
      id: row.manual_takeoff.id, client_key: clientKey, was_update: row.was_update,
      quantity, unit: it.unit ?? (it.takeoff_type === "count" ? "EA" : it.takeoff_type === "length" ? "LF" : "SF"),
      row_version: row.manual_takeoff.row_version,
      calculation_formula_version: calculationFormulaVersion, discrepancy_warning: discrepancyWarning, calibration_warning: calibrationWarning,
    });

    // save_manual_takeoff_tx always writes a pending 'upsert' outbox event —
    // it has no knowledge of calibration state. An item on an unverified
    // sheet must NOT sync to the estimate yet (policy stated above), so its
    // outbox row is marked processed-as-skipped immediately, rather than
    // left pending (which the worker would otherwise pick up and sync
    // anyway) or left pending forever (which would violate "failed events
    // cannot remain pending indefinitely" once a real retry worker exists).
    if (calibrationWarning) {
      await anyDb.from("estimate_sync_outbox")
        .update({ status: "processed", processed_at: new Date().toISOString(), last_error: `skipped: ${calibrationWarning}` })
        .eq("tenant_id", tenantId).eq("manual_takeoff_id", row.manual_takeoff.id).eq("event_type", "upsert").eq("status", "pending");
    } else {
      projectIdsNeedingSync.add(it.project_id);
    }
  }

  void logEvent({
    projectId: items[0].project_id,
    tenantId,
    userId,
    entityType: "takeoff",
    entityId: results[0]?.id ?? items[0].project_id,
    action: "created",
    title: `Manual takeoff: ${items.length} item${items.length === 1 ? "" : "s"} saved`,
    meta: { count: items.length, used_verified_calibration: anyVerifiedCalibrationUsed },
  });

  // Opportunistic outbox processing (STEP 14): fire-and-forget so the HTTP
  // response is not blocked on claim/complete. Failures leave events
  // `pending` with backoff (or `dead_letter`) for the cron path — see
  // lib/estimating/outbox-worker.ts and OUTBOX_WORKER.md.
  void projectIdsNeedingSync;
  void processOutboxBatch(anyDb, `inline-post-${Date.now()}`, 20).catch((err) => {
    console.error("[canvas/manual] inline outbox processing failed", err);
  });

  return NextResponse.json({ ok: true, items: results, outbox_processed: "async" });
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

  const { data, error } = await anyDb.rpc("soft_delete_manual_takeoff_tx", {
    p_id: id, p_tenant_id: tenantId, p_actor_user_id: userId,
  }).single();
  if (error) {
    if (error.message?.includes("not found")) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as { already_deleted: boolean; manual_takeoff: { id: string; project_id: string } };

  void processOutboxBatch(anyDb, `inline-delete-${Date.now()}`, 20).catch((err) => {
    console.error("[canvas/manual] delete outbox processing failed", err);
  });

  return NextResponse.json({ ok: true, already_deleted: row.already_deleted, outbox_processed: "async" });
}

/**
 * PUT { id } → restore a soft-deleted manual takeoff (inverse of DELETE).
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string };
  const id = body.id ?? req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data, error } = await anyDb.rpc("restore_manual_takeoff_tx", {
    p_id: id, p_tenant_id: tenantId, p_actor_user_id: userId,
  }).single();
  if (error) {
    if (error.message?.includes("not found")) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as {
    already_active: boolean;
    manual_takeoff: { id: string; project_id: string };
    mirror_takeoff_item_id: string | null;
  };

  void processOutboxBatch(anyDb, `inline-restore-${Date.now()}`, 20).catch((err) => {
    console.error("[canvas/manual] restore outbox processing failed", err);
  });

  return NextResponse.json({
    ok: true,
    already_active: row.already_active,
    item: row.manual_takeoff,
    mirror_takeoff_item_id: row.mirror_takeoff_item_id,
    outbox_processed: "async",
  });
}

type UpdateBody = Partial<ManualTakeoffUpdateBody>;

/**
 * PATCH { id, row_version, quantity, unit?, cost_code?, geometry }
 *      → edits an ALREADY-SAVED object via `update_manual_takeoff_tx`
 *        (optimistic concurrency — STEP 2). `row_version` must match the
 *        version the client last read; a mismatch returns
 *        `{ conflict: true, server_state }` (HTTP 409), never silently
 *        overwriting a concurrent edit. Recalculates quantity server-side
 *        against a verified calibration exactly like POST.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as UpdateBody;
  if (!body.id || typeof body.row_version !== "number") {
    return NextResponse.json({ error: "id and row_version required" }, { status: 400 });
  }
  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) {
    return NextResponse.json({ error: "quantity must be a number" }, { status: 400 });
  }
  if (body.cost_code && !COST_CODE_RE.test(body.cost_code)) {
    return NextResponse.json({ error: `cost_code must be NN-NN-NN, got "${body.cost_code}"` }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: existing, error: fetchErr } = await anyDb
    .from("manual_takeoffs").select("project_id, page_id, takeoff_type").eq("id", body.id).eq("tenant_id", tenantId).maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  let quantity = body.quantity;
  let calculationFormulaVersion: string | null = null;
  let discrepancyWarning: string | null = null;
  const geo = body.geometry ?? {};
  const isPageSpace = geo.coordinate_space === "page_space" && Array.isArray(geo.points);
  if (existing.page_id && isPageSpace) {
    const { data: calibration } = await anyDb
      .from("sheet_calibrations").select("page_space_scale_factor, status").eq("tenant_id", tenantId).eq("page_id", existing.page_id).maybeSingle();
    if (calibration?.status === "verified" && calibration.page_space_scale_factor != null) {
      const points = geo.points as Point[];
      let serverQuantity: number;
      if (existing.takeoff_type === "count") serverQuantity = calculateCount(points);
      else if (existing.takeoff_type === "length") serverQuantity = calculateLinearLength(points, calibration.page_space_scale_factor);
      else serverQuantity = calculatePolygonArea(points, calibration.page_space_scale_factor);

      const pctDiff = body.quantity !== 0 ? Math.abs(serverQuantity - body.quantity) / Math.abs(body.quantity) * 100 : (serverQuantity === 0 ? 0 : 100);
      if (pctDiff > QUANTITY_TOLERANCE_PCT) {
        discrepancyWarning = `submitted quantity ${body.quantity} differed from server-calculated ${serverQuantity.toFixed(4)} by ${pctDiff.toFixed(1)}% — server value used`;
      }
      quantity = serverQuantity;
      calculationFormulaVersion = FORMULA_VERSION;
    }
  }

  const { data, error } = await anyDb.rpc("update_manual_takeoff_tx", {
    p_id: body.id,
    p_tenant_id: tenantId,
    p_expected_row_version: body.row_version,
    p_geometry: body.geometry ?? {},
    p_quantity: quantity,
    p_unit: body.unit ?? null,
    p_cost_code: body.cost_code ?? null,
    p_actor_user_id: userId,
    p_calculation_formula_version: calculationFormulaVersion,
  }).single();
  if (error) {
    if (error.message?.includes("soft-deleted")) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error.message?.includes("not found")) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data as { conflict: boolean; manual_takeoff: Record<string, unknown>; mirror_takeoff_item_id: string | null };
  if (row.conflict) {
    return NextResponse.json({ conflict: true, server_state: row.manual_takeoff }, { status: 409 });
  }

  void processOutboxBatch(anyDb, `inline-patch-${Date.now()}`, 20).catch((err) => {
    console.error("[canvas/manual] patch outbox processing failed", err);
  });

  return NextResponse.json({
    ok: true, conflict: false, manual_takeoff: row.manual_takeoff,
    quantity, calculation_formula_version: calculationFormulaVersion, discrepancy_warning: discrepancyWarning,
    outbox_processed: "async",
  });
}
