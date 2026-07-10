import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prepareTakeoffRowsForSave } from "@/lib/estimating/takeoff-import";
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { takeoffItemsSchema, parseBody } from "@/lib/validation";
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
    if (!projectId) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams, 100);
    const db = await createServiceClient();
    const { data, error, count } = await db
      .from("takeoff_items")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

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
    const db = await createServiceClient();
    const { data: existing, error: existingError } = await db
      .from("takeoff_items")
      .select("id,label,csi_code,division,quantity,unit,type,meta")
      .eq("tenant_id", tenantId)
      .eq("project_id", project_id);

    if (existingError) {
      return NextResponse.json({ error: `[POST /api/takeoff/items] ${existingError.message}` }, { status: 422 });
    }

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

    const payload = prepared.rows.map((row) => ({
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
      meta: (row.meta ?? {}) as Json,
    }));

    const { data, error } = await db
      .from("takeoff_items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: "id" })
      .select();

    if (error) {
      return NextResponse.json({ error: `[POST /api/takeoff/items] ${error.message}` }, { status: 422 });
    }

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
    const db = await createServiceClient();

    const query = db.from("takeoff_items").delete().eq("id", id).eq("tenant_id", tenantId).eq("project_id", project_id);

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/takeoff/items] ${msg}` }, { status: 500 });
  }
}
