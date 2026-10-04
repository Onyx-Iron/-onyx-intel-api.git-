import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.ctx.db
    .from("project_meetings")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("meeting_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (data ?? []).map((row: { id: string }) => row.id);
  const { data: actions } = ids.length
    ? await gate.ctx.db.from("project_meeting_actions").select("*").in("meeting_id", ids).eq("tenant_id", gate.ctx.tenantId)
    : { data: [] };
  return NextResponse.json({ meetings: data ?? [], actions: actions ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    title?: string;
    meeting_date?: string;
    notes?: string | null;
    actions?: Array<{ title?: string; assignee?: string | null; due_date?: string | null }>;
  };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;
  const title = body.title?.trim();
  if (!title || !body.meeting_date) return NextResponse.json({ error: "title and meeting_date are required" }, { status: 400 });

  const { data: meeting, error } = await gate.ctx.db.from("project_meetings").insert({
    tenant_id: gate.ctx.tenantId,
    project_id: gate.projectId,
    title,
    meeting_date: body.meeting_date,
    notes: body.notes ?? null,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  for (const action of body.actions ?? []) {
    const actionTitle = action.title?.trim();
    if (!actionTitle) continue;
    const { data: todo, error: todoError } = await gate.ctx.db.from("todo_items").insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      title: actionTitle,
      assignee: action.assignee ?? null,
      due_date: action.due_date ?? null,
      status: "open",
    }).select("id").single();
    if (todoError) return NextResponse.json({ error: todoError.message }, { status: 422 });
    const { data: saved, error: actionError } = await gate.ctx.db.from("project_meeting_actions").insert({
      meeting_id: meeting.id,
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      title: actionTitle,
      assignee: action.assignee ?? null,
      due_date: action.due_date ?? null,
      todo_id: todo.id,
    }).select("id").single();
    if (actionError) return NextResponse.json({ error: actionError.message }, { status: 422 });
    await gate.ctx.db.from("project_record_links").insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      from_type: "meeting",
      from_id: meeting.id,
      to_type: "todo",
      to_id: todo.id,
      link_role: "related",
    });
    void saved;
  }
  return NextResponse.json({ meeting }, { status: 201 });
}
