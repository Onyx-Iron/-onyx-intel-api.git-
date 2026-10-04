import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("project_inspections")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inspections: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    inspection_type?: string;
    status?: string;
    result?: string | null;
    inspected_on?: string | null;
    document_id?: string | null;
    sheet_pin_id?: string | null;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;
  const inspectionType = body.inspection_type?.trim();
  if (!inspectionType) return NextResponse.json({ error: "inspection_type required" }, { status: 400 });
  const { data, error } = await gate.ctx.db.from("project_inspections").insert({
    tenant_id: gate.ctx.tenantId,
    project_id: gate.projectId,
    inspection_type: inspectionType,
    status: body.status ?? "scheduled",
    result: body.result ?? null,
    inspected_on: body.inspected_on ?? null,
    document_id: body.document_id ?? null,
    sheet_pin_id: body.sheet_pin_id ?? null,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ inspection: data }, { status: 201 });
}
