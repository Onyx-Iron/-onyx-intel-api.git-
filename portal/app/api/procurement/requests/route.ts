import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { logEvent } from "@/lib/activity";
import { auditInsert } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Procurement Marketplace — RFQ requests.
 *
 * GET  ?project_id=  → { batches: [{ batch_id, batch_label, required_date, items: [...], bids_by_request: {...} }] }
 * POST { project_id, batch_label?, required_date?, items: [{ description, quantity, unit, source_estimate_id? }] }
 *      → "Quote Packaging" wizard: bundles checked estimate rows into one
 *        marketplace_requests row per item, sharing a batch_id.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // project_id is optional so the global Procurement workspace can roll up
  // RFQs/bids/POs across every project for the tenant; every project-scoped
  // caller still passes it explicitly.
  const projectId = req.nextUrl.searchParams.get("project_id");

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  let requestsQuery = anyDb
    .from("marketplace_requests")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (projectId) requestsQuery = requestsQuery.eq("project_id", projectId);
  const { data: requests, error } = await requestsQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const requestIds = (requests ?? []).map((r: { id: string }) => r.id);
  const { data: bids } = requestIds.length > 0
    ? await anyDb.from("vendor_bids").select("*").in("request_id", requestIds).order("unit_price", { ascending: true })
    : { data: [] };

  let posQuery = anyDb.from("purchase_orders").select("*").eq("tenant_id", tenantId);
  if (projectId) posQuery = posQuery.eq("project_id", projectId);
  const { data: pos } = requestIds.length > 0 ? await posQuery : { data: [] };

  // Group requests by batch_id so the UI can render one RFQ card with
  // multiple line items instead of one card per row.
  const batches = new Map<string, { batch_id: string; batch_label: string | null; required_date: string | null; items: unknown[] }>();
  for (const r of requests ?? []) {
    const key = r.batch_id;
    if (!batches.has(key)) batches.set(key, { batch_id: key, batch_label: r.batch_label, required_date: r.required_date, items: [] });
    batches.get(key)!.items.push({
      ...r,
      bids: (bids ?? []).filter((b: { request_id: string }) => b.request_id === r.id),
    });
  }

  return NextResponse.json({ batches: Array.from(batches.values()), purchase_orders: pos ?? [] });
}

interface RequestItem {
  description: string;
  quantity: number;
  unit?: string | null;
  source_estimate_id?: string | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    batch_label?: string;
    required_date?: string | null;
    items?: RequestItem[];
  };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items[] required" }, { status: 400 });
  for (const it of items) {
    if (!it.description || typeof it.quantity !== "number" || !Number.isFinite(it.quantity)) {
      return NextResponse.json({ error: "each item needs description + numeric quantity" }, { status: 400 });
    }
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "financial", "write");
  if (denied) return denied;
  try {
    await assertProjectBelongsToTenant(body.project_id, tenantId);
  } catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const batchId = crypto.randomUUID();

  const rows = items.map((it) => ({
    tenant_id: tenantId,
    project_id: body.project_id,
    batch_id: batchId,
    batch_label: body.batch_label ?? null,
    source_estimate_id: it.source_estimate_id ?? null,
    item_description: it.description,
    quantity: it.quantity,
    unit: it.unit ?? null,
    required_date: body.required_date ?? null,
    created_by: userId,
  }));

  const { data, error } = await anyDb.from("marketplace_requests").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const row of data ?? []) {
    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "marketplace_requests",
      record_id: row.id,
      new_values: { batch_id: batchId, project_id: body.project_id },
    });
  }

  void logEvent({
    projectId: body.project_id,
    tenantId, userId,
    entityType: "procurement",
    entityId: batchId,
    action: "created",
    title: `RFQ packaged: ${items.length} item${items.length === 1 ? "" : "s"}${body.batch_label ? ` — ${body.batch_label}` : ""}`,
    meta: { count: items.length },
  });

  return NextResponse.json({ ok: true, batch_id: batchId, ids: (data ?? []).map((d: { id: string }) => d.id) });
}
