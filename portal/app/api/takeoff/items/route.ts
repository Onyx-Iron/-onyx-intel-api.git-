import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prepareTakeoffRowsForSave } from "@/lib/estimating/takeoff-import";
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { takeoffItemsSchema, parseBody } from "@/lib/validation";
import { detachedTakeoffEstimateFields, filterDraftEstimateItemIds } from "@/lib/estimating/delete-reconcile";
import { recordTakeoffHistory, recordTakeoffHistoryBatch } from "@/lib/takeoff/history";
import { isVisionMeta, provenanceForNewItem } from "@/lib/takeoff/provenance";
import type { Json } from "@/lib/supabase/types";

function jsonObject(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("project_id");

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams, 100);
    const db = await createServiceClient();
    // project_id is optional here so the global Takeoff workspace can roll
    // up items across every project for the tenant; every project-scoped
    // caller still passes it explicitly.
    let query = db
      .from("takeoff_items")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: `[GET /api/takeoff/items] ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [], pagination: paginationMeta(count ?? 0, page, limit) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/takeoff/items] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await req.json();
    const validation = parseBody(takeoffItemsSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { project_id, rows } = validation.data;

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    // project_id is client-supplied — never trust it without verifying it
    // actually belongs to the caller's own tenant before using it to scope
    // an insert (STEP 7: "do not trust tenant_id or project_id supplied by
    // the browser without verification").
    try {
      await assertProjectBelongsToTenant(project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: existing, error: existingError } = await db
      .from("takeoff_items")
      .select("id, label, csi_code, division, quantity, unit, type, meta")
      .eq("tenant_id", tenantId)
      .eq("project_id", project_id);

    if (existingError) {
      return NextResponse.json({ error: `[POST /api/takeoff/items] ${existingError.message}` }, { status: 422 });
    }

    const existingById = new Map((existing ?? []).map((row) => [row.id as string, row]));
    const existingRows = (existing ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      csi_code: row.csi_code,
      division: row.division,
      quantity: row.quantity,
      unit: row.unit,
      type: row.type,
      meta: jsonObject(row.meta),
    }));

    const prepared = prepareTakeoffRowsForSave(rows, existingRows);
    if (prepared.rows.length === 0) {
      return NextResponse.json({ items: [], skipped: prepared.skipped }, { status: 201 });
    }

    const payload = prepared.rows.map((row) => {
      const isUpdate = row.id != null && existingById.has(row.id);
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const vision = isVisionMeta(meta);
      const stamp = provenanceForNewItem({
        sourceMethod: vision ? "ai_vision" : "manual",
        isVisionSourced: vision,
      });
      const metaWithOrigin = {
        ...meta,
        extraction_method: stamp.source_method,
        origin_actor: stamp.origin_actor,
        origin_method: stamp.origin_method,
      } as Json;
      return {
        id: row.id ?? crypto.randomUUID(),
        tenant_id: tenantId,
        project_id,
        label: row.label ?? "Untitled item",
        csi_code: row.csi_code ?? null,
        division: row.division ?? null,
        quantity: row.quantity ?? null,
        unit: row.unit ?? null,
        rate: row.rate ?? null,
        type: row.type ?? "general",
        page: row.page ?? 0,
        document_id: row.document_id ?? null,
        meta: metaWithOrigin,
        updated_by: userId,
        // New human/deterministic rows are approved. AI vision rows land as
        // suggested with origin_actor=agent and must be sealed via the
        // review endpoint before estimate sync (OSS-04/05).
        ...(isUpdate
          ? {}
          : {
              created_by: vision ? null : userId,
              review_status: stamp.review_status,
              source_method: stamp.source_method,
              origin_actor: stamp.origin_actor,
              origin_method: stamp.origin_method,
              origin_edited: stamp.origin_edited,
            }),
      };
    });

    const { data, error } = await db
      .from("takeoff_items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: "id" })
      .select();

    if (error) {
      return NextResponse.json({ error: `[POST /api/takeoff/items] ${error.message}` }, { status: 422 });
    }

    // Per-row history: "created" for genuinely new rows, "updated" (with
    // before/after) for edits to an existing row — satisfies "edits and
    // deletions preserve audit history". Batched into one insert (P-04 fix
    // from the milestone-1 validation pass — this was previously N
    // sequential awaited inserts for a batch of N takeoff items).
    await recordTakeoffHistoryBatch(anyDb, (data ?? []).map((row) => {
      const before = existingById.get(row.id as string);
      return {
        tenantId, projectId: project_id, takeoffItemId: row.id as string,
        action: (before ? "updated" : "created") as "updated" | "created",
        actorUserId: userId,
        before: before ?? null,
        after: row as Record<string, unknown>,
      };
    }));

    void logEvent({
      projectId: project_id,
      tenantId,
      userId,
      entityType: "takeoff",
      action: "created",
      title: `Takeoff updated: ${(data ?? []).length} items`,
      meta: { item_count: (data ?? []).length, skipped: prepared.skipped },
    });

    // Keep the estimate in sync automatically — no manual "Import from
    // Takeoff" click required. Idempotent (dedupes by source_takeoff_id /
    // fingerprint), so this never double-imports.
    const sync = await syncTakeoffToEstimate(tenantId, project_id);

    return NextResponse.json({ items: data ?? [], skipped: prepared.skipped, estimate_synced: sync }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/takeoff/items] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    const project_id = req.nextUrl.searchParams.get("project_id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    try {
      await assertProjectBelongsToTenant(project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const { data: before } = await db
      .from("takeoff_items")
      .select("*")
      .eq("id", id).eq("tenant_id", tenantId).eq("project_id", project_id)
      .maybeSingle();

    // Capture draft lines first. Deleting the takeoff row SET NULLs
    // source_takeoff_id, which would hide the link, and the price would stay.
    const { data: linkedItems, error: linkedErr } = await db
      .from("estimate_items")
      .select("id, estimate_version_id, notes")
      .eq("tenant_id", tenantId)
      .eq("project_id", project_id)
      .eq("source_takeoff_id", id);
    if (linkedErr) return NextResponse.json({ error: linkedErr.message }, { status: 422 });

    const linked = (linkedItems ?? []).flatMap((row) => (
      row.estimate_version_id
        ? [{ id: row.id, estimate_version_id: row.estimate_version_id, notes: row.notes }]
        : []
    ));
    let draftLines = linked;
    if (linked.length > 0) {
      const versionIds = [...new Set(linked.map((row) => row.estimate_version_id))];
      const { data: versions, error: versionErr } = await db
        .from("estimate_versions")
        .select("id, status")
        .in("id", versionIds);
      if (versionErr) return NextResponse.json({ error: versionErr.message }, { status: 422 });
      const draftIds = new Set(filterDraftEstimateItemIds(linked, versions ?? []));
      draftLines = linked.filter((row) => draftIds.has(row.id));
    }

    const { error } = await db
      .from("takeoff_items")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", project_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    await recordTakeoffHistory(anyDb, {
      tenantId, projectId: project_id, takeoffItemId: id, action: "deleted",
      actorUserId: userId, before: before ?? null,
    });

    for (const line of draftLines) {
      // Approved versions are not in draftLines. A locked reference still
      // rejects the delete above, so those rows are never updated.
      const { error: reconcileErr } = await db
        .from("estimate_items")
        .update(detachedTakeoffEstimateFields(line.notes))
        .eq("id", line.id)
        .eq("tenant_id", tenantId)
        .eq("project_id", project_id);
      if (reconcileErr) {
        return NextResponse.json({ error: reconcileErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/takeoff/items] ${msg}` }, { status: 500 });
  }
}
