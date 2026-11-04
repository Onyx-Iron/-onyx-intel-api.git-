import { NextRequest, NextResponse } from "next/server";
import { projectContext } from "@/lib/project-file/api";
import { readAllPages, tasksInLookahead } from "@/lib/project-file/schedule-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  let rows: Array<{
    id: string;
    name: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    critical: boolean | null;
    total_float: number | null;
    percent_complete: number | null;
    deps: string[] | null;
  }>;
  try {
    rows = await readAllPages(async (offset, limit) => {
      const { data, error } = await gate.ctx.db
        .from("schedule_tasks")
        .select("id, name, status, start_date, end_date, critical, total_float, percent_complete, deps")
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
  const flags = tasksInLookahead(rows, new Date(), 21);
  const windowTasks = rows.filter((_: unknown, index: number) => flags[index]);
  const ids = new Set(windowTasks.map((task: { id: string }) => task.id));
  const { data: links } = await gate.ctx.db
    .from("project_record_links")
    .select("*")
    .eq("tenant_id", gate.ctx.tenantId)
    .eq("project_id", gate.projectId)
    .in("link_role", ["blocks", "requires"]);
  const blockers = (links ?? []).filter((link: { from_type: string; from_id: string; to_type: string; to_id: string }) =>
    (link.from_type === "schedule_task" && ids.has(link.from_id))
    || (link.to_type === "schedule_task" && ids.has(link.to_id)),
  );
  return NextResponse.json({ tasks: windowTasks, blockers });
}
