import { NextRequest, NextResponse } from "next/server";
import { projectContext, requireProjectWrite } from "@/lib/project-file/api";
import { readAllPages } from "@/lib/project-file/schedule-store";

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
    try {
      tasks = await readAllPages(async (offset, limit) => {
        const { data, error } = await gate.ctx.db
          .from("schedule_baseline_tasks")
          .select("*")
          .eq("baseline_id", current.id)
          .eq("tenant_id", gate.ctx.tenantId)
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1);
        return { data, error };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  return NextResponse.json({ baselines: baselines ?? [], current, tasks });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as { project_id?: string; name?: string };
  const gate = await projectContext(body.project_id ?? null);
  if (!gate.ok) return gate.response;
  const denied = await requireProjectWrite(gate.ctx, "field");
  if (denied) return denied;

  let tasks: Array<{
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    duration: number | null;
    critical: boolean | null;
  }>;
  try {
    tasks = await readAllPages(async (offset, limit) => {
      const { data, error } = await gate.ctx.db
        .from("schedule_tasks")
        .select("id, name, start_date, end_date, duration, critical")
        .eq("tenant_id", gate.ctx.tenantId)
        .eq("project_id", gate.projectId)
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      return { data, error };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Stay non-current until every task is copied. Clearing the live baseline
  // first left the project with no baseline when the copy failed, and a
  // single select dropped every task past max_rows.
  const { data: baseline, error } = await gate.ctx.db
    .from("schedule_baselines")
    .insert({
      tenant_id: gate.ctx.tenantId,
      project_id: gate.projectId,
      name: body.name?.trim() || `Baseline ${new Date().toISOString().slice(0, 10)}`,
      is_current: false,
      created_by: gate.ctx.userId,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });

  const lines = tasks.map((task) => ({
    baseline_id: baseline.id,
    tenant_id: gate.ctx.tenantId,
    project_id: gate.projectId,
    source_task_id: task.id,
    name: task.name,
    start_date: task.start_date,
    end_date: task.end_date,
    duration: task.duration,
    critical: task.critical ?? false,
  }));
  const chunkSize = 200;
  for (let index = 0; index < lines.length; index += chunkSize) {
    const { error: lineError } = await gate.ctx.db
      .from("schedule_baseline_tasks")
      .insert(lines.slice(index, index + chunkSize));
    if (lineError) {
      await gate.ctx.db
        .from("schedule_baselines")
        .delete()
        .eq("id", baseline.id)
        .eq("tenant_id", gate.ctx.tenantId);
      return NextResponse.json({ error: lineError.message }, { status: 422 });
    }
  }

  const { data: previous } = await gate.ctx.db
    .from("schedule_baselines")
    .select("id")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .eq("is_current", true)
    .maybeSingle();

  const { error: clearError } = await gate.ctx.db
    .from("schedule_baselines")
    .update({ is_current: false })
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .eq("is_current", true);
  if (clearError) {
    await gate.ctx.db.from("schedule_baselines").delete().eq("id", baseline.id).eq("tenant_id", gate.ctx.tenantId);
    return NextResponse.json({ error: clearError.message }, { status: 422 });
  }

  const { data: current, error: currentError } = await gate.ctx.db
    .from("schedule_baselines")
    .update({ is_current: true })
    .eq("id", baseline.id)
    .eq("tenant_id", gate.ctx.tenantId)
    .select("*")
    .single();
  if (currentError) {
    if (previous?.id) {
      await gate.ctx.db
        .from("schedule_baselines")
        .update({ is_current: true })
        .eq("id", previous.id)
        .eq("tenant_id", gate.ctx.tenantId);
    }
    await gate.ctx.db.from("schedule_baselines").delete().eq("id", baseline.id).eq("tenant_id", gate.ctx.tenantId);
    return NextResponse.json({ error: currentError.message }, { status: 422 });
  }
  return NextResponse.json({ baseline: current }, { status: 201 });
}
