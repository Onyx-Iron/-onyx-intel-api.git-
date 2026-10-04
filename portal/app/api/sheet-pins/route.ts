import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";
import { isRecordType, sheetPinInsert, type RecordType } from "@/lib/project-file/records";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  let query = gate.ctx.db
    .from("sheet_pins")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId);
  const pageId = req.nextUrl.searchParams.get("page_id");
  if (pageId) query = query.eq("page_id", pageId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pins: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = typeof body.project_id === "string" ? body.project_id : null;
  const gate = await projectContext(projectId);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;

  const entityType = String(body.entity_type ?? "");
  if (!isRecordType(entityType)) return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
  const entityId = String(body.entity_id ?? "");
  const pageId = String(body.page_id ?? "");
  const x = Number(body.x);
  const y = Number(body.y);
  if (!entityId || !pageId || !Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "page_id, entity_id, x, and y are required" }, { status: 400 });
  }

  const payload = sheetPinInsert({
    project_id: gate.projectId,
    page_id: pageId,
    entity_type: entityType as RecordType,
    entity_id: entityId,
    x,
    y,
    label: typeof body.label === "string" ? body.label : null,
  }, gate.ctx.tenantId);

  const { data, error } = await gate.ctx.db.from("sheet_pins").insert(payload).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ pin: data }, { status: 201 });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await gate.ctx.db
    .from("sheet_pins")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
