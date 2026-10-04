import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant, getControlDb,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { buildRfiPayload } from "@/lib/project-controls/schema";
import { buildSheetPin, type PinKind } from "@/lib/takeoff/canvas/sheet-pin";

export const runtime = "nodejs";

/** Non-quantity sheet markups — never sync to estimates. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try { await assertProjectBelongsToTenant(projectId, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (db as any).from("sheet_markups").select("*").eq("tenant_id", tenantId).eq("project_id", projectId);
  if (pageId) q = q.eq("page_id", pageId);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ markups: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    page_id?: string;
    markup_type?: string;
    geometry?: Record<string, unknown>;
    label?: string;
    color?: string;
    kind?: PinKind;
    note?: string;
    page_number?: number;
    sheet_name?: string;
  };
  if (!body.project_id || !body.markup_type) {
    return NextResponse.json({ error: "project_id and markup_type required" }, { status: 400 });
  }
  try { await assertProjectBelongsToTenant(body.project_id, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  let geometry: Record<string, unknown> = body.geometry ?? {};
  let label = body.label ?? null;
  let color = body.color ?? "#F5A623";

  if (body.markup_type === "pin") {
    const point = geometry.point && typeof geometry.point === "object"
      ? geometry.point as { x?: unknown; y?: unknown }
      : null;
    const x = Number(point?.x);
    const y = Number(point?.y);
    const pageNumber = Number(body.page_number ?? geometry.page_number);
    const kind = body.kind === "rfi" ? "rfi" : body.kind === "punch" ? "punch" : null;
    if (!kind || !Number.isFinite(x) || !Number.isFinite(y)) {
      return NextResponse.json({ error: "A pin needs a page-space point and kind punch or rfi" }, { status: 400 });
    }
    const pin = buildSheetPin({
      note: body.note ?? body.label ?? "",
      kind,
      pageNumber,
      point: { x, y },
      sheetName: body.sheet_name ?? null,
      projectId: body.project_id,
    });
    if (!pin) return NextResponse.json({ error: "A pin needs a note and a page number" }, { status: 400 });
    label = pin.label;
    color = kind === "rfi" ? "#7DD3FC" : "#F5A623";
    if (pin.punch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const punchTable = (db as any).from("punch_list_items");
      const { data: maxRow } = await punchTable
        .select("item_number")
        .eq("tenant_id", tenantId)
        .eq("project_id", body.project_id)
        .order("item_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextNumber = (Number(maxRow?.item_number) || 0) + 1;
      const { data: punch, error: punchError } = await punchTable
        .insert({
          tenant_id: tenantId,
          project_id: body.project_id,
          item_number: nextNumber,
          description: pin.punch.description,
          location: pin.punch.location,
          priority: "medium",
          status: "open",
        })
        .select("id")
        .single();
      if (punchError) return NextResponse.json({ error: punchError.message }, { status: 422 });
      geometry = { ...pin.geometry, punch_item_id: punch.id };
    } else if (pin.rfi) {
      const payload = buildRfiPayload(
        { subject: pin.rfi.subject, description: pin.rfi.description, status: "open" },
        { tenantId, projectId: body.project_id },
      );
      const controls = await getControlDb();
      const { data: rfi, error: rfiError } = await controls
        .from<unknown>("rfi_items")
        .insert(payload)
        .select("id")
        .single();
      if (rfiError) return NextResponse.json({ error: rfiError.message }, { status: 422 });
      geometry = { ...pin.geometry, rfi_id: (rfi as { id: string }).id };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("sheet_markups")
    .insert({
      tenant_id: tenantId,
      project_id: body.project_id,
      page_id: body.page_id ?? null,
      markup_type: body.markup_type,
      geometry,
      label,
      color,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ markup: data }, { status: 201 });
}
