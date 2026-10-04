import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const { data: baselines, error } = await gate.ctx.db
    .from("schedule_baselines")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const current = (baselines ?? []).find((row: { is_current: boolean }) => row.is_current) ?? null;
  let tasks: unknown[] = [];
  if (current) {
    const { data } = await gate.ctx.db
      .from("schedule_baseline_tasks")
      .select("*")
      .eq("baseline_id", current.id)
      .eq("tenant_id", gate.ctx.tenantId);
    tasks = data ?? [];
  }
  return NextResponse.json({ baselines: baselines ?? [], current, tasks });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as { project_id?: string; name?: string };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;

  await gate.ctx.db
    .from("schedule_baselines")
    .update({ is_current: false })
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .eq("is_current", true);

  const { data: baseline, error } = await gate.ctx.db
    .from("schedule_baselines")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      name: body.name?.trim() || `Baseline ${new Date().toISOString().slice(0, 10)}`,
      is_current: true,
      created_by: gate.ctx.userId,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  const { data: tasks } = await gate.ctx.db
    .from("schedule_tasks")
    .select("id, name, start_date, end_date, duration, critical")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId);
  if (tasks?.length) {
    const { error: lineError } = await gate.ctx.db.from("schedule_baseline_tasks").insert(
      tasks.map((task: { id: string; name: string; start_date: string | null; end_date: string | null; duration: number | null; critical: boolean | null }) => ({
        baseline_id: baseline.id,
        tenant_id: gate.ctx.tenantId,
        project_id: gate.projectId,
        source_task_id: task.id,
        name: task.name,
        start_date: task.start_date,
        end_date: task.end_date,
        duration: task.duration,
        critical: task.critical ?? false,
      })),
    );
    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 422 });
  }
  return NextResponse.json({ baseline }, { status: 201 });
}
