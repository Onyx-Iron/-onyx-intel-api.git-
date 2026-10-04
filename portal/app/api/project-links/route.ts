import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";
import { isLinkRole, isRecordType } from "@/lib/project-file/records";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("project_record_links")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = typeof body.project_id === "string" ? body.project_id : null;
  const gate = await projectContext(projectId);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;

  const fromType = String(body.from_type ?? "");
  const toType = String(body.to_type ?? "");
  const role = String(body.link_role ?? "");
  const fromId = String(body.from_id ?? "");
  const toId = String(body.to_id ?? "");
  if (!isRecordType(fromType) || !isRecordType(toType) || !isLinkRole(role)) {
    return NextResponse.json({ error: "Invalid link types or role" }, { status: 400 });
  }

  const { data, error } = await gate.ctx.db
    .from("project_record_links")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      from_type: fromType,
      from_id: fromId,
      to_type: toType,
      to_id: toId,
      link_role: role,
    })
    .select("*")
    .single();
  if (error) {
    const status = String(error.message).includes("same project") ? 409 : 422;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ link: data }, { status: 201 });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await gate.ctx.db
    .from("project_record_links")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
