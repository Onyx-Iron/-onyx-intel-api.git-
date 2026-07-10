import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { logEvent } from "@/lib/activity";
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";

export const runtime = "nodejs";

/**
 * Manual takeoff persistence.
 *
 * GET  ?project_id=&page_id=  → list rows for the given scope.
 * POST { items: [{ project_id, page_id?, cost_code?, takeoff_type, quantity, unit?, geometry }] }
 *      → bulk insert.
 * DELETE ?id=  → delete one row.
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
    .eq("project_id", projectId);
  if (pageId) query = query.eq("page_id", pageId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

interface Item {
  project_id: string;
  page_id?: string | null;
  cost_code?: string | null;
  takeoff_type: string;     // count | length | area
  quantity: number;
  unit?: string | null;     // EA | LF | SF
  geometry: unknown;
}

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
  const db = await createServiceClient();

  const rows = items.map((it) => ({
    tenant_id: tenantId,
    project_id: it.project_id,
    page_id: it.page_id ?? null,
    cost_code: it.cost_code ?? null,
    takeoff_type: it.takeoff_type,
    quantity: it.quantity,
    unit: it.unit ?? (it.takeoff_type === "count" ? "EA" : it.takeoff_type === "length" ? "LF" : "SF"),
    geometry: it.geometry,
    created_by: userId,
    created_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data, error } = await anyDb.from("manual_takeoffs").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const projectId = items[0].project_id;

  // Mirror into takeoff_items so this feeds the estimate the same way
  // deterministic/AI-extracted takeoff rows do — manual canvas measurements
  // and vision-approved items shouldn't require a second entry to price.
  const takeoffPayload = items.map((it, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geo = (it.geometry ?? {}) as Record<string, any>;
    return {
      tenant_id: tenantId,
      project_id: it.project_id,
      label: typeof geo.description === "string" ? geo.description : "Manual takeoff item",
      csi_code: it.cost_code ?? null,
      division: it.cost_code ? it.cost_code.slice(0, 2) : null,
      quantity: it.quantity,
      unit: it.unit ?? null,
      type: "takeoff_import",
      page: 0,
      document_id: it.page_id ?? null,
      meta: {
        trade: null,
        quantity_basis: null,
        drawing_ref: typeof geo.layer_hint === "string" ? geo.layer_hint : null,
        location_tag: null,
        extraction_method: geo.source === "vision_extraction" ? "ai_vision" : "manual",
        manual_takeoff_id: data?.[i]?.id ?? null,
      },
    };
  });
  const { error: takeoffErr } = await anyDb.from("takeoff_items").insert(takeoffPayload);
  if (takeoffErr) console.error("[canvas/manual] takeoff_items mirror failed", takeoffErr);

  void logEvent({
    projectId,
    tenantId,
    userId,
    entityType: "takeoff",
    entityId: (data?.[0]?.id as string) ?? projectId,
    action: "created",
    title: `Manual takeoff: ${items.length} item${items.length === 1 ? "" : "s"} saved`,
    meta: { count: items.length },
  });

  const sync = takeoffErr ? null : await syncTakeoffToEstimate(tenantId, projectId);

  return NextResponse.json({ ok: true, inserted: rows.length, ids: (data ?? []).map((d: { id: string }) => d.id), estimate_synced: sync });
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
    .from("manual_takeoffs")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
