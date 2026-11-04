import { computeCpm, CpmCycleError, durationDays } from "@/lib/project-file/cpm";
import type { AnyDb } from "@/lib/project-file/api";

interface TaskRow {
  id: string;
  name: string;
  duration: number | null;
  start_date: string | null;
  end_date: string | null;
  deps: string[] | null;
  status: string;
  percent_complete: number | null;
}

export class ScheduleTaskDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleTaskDeleteError";
  }
}

/**
 * Remove one task, then recompute float and the critical path for whatever
 * remains. Callers that only delete leave the stored CPM columns on the
 * other activities pointing at a schedule that no longer exists.
 */
export async function deleteScheduleTask(
  db: AnyDb,
  tenantId: string,
  taskId: string,
): Promise<{ deleted: false } | { deleted: true; projectId: string; updated: number }> {
  const { data: before, error: readError } = await db
    .from("schedule_tasks")
    .select("id, project_id")
    .eq("id", taskId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError) throw new ScheduleTaskDeleteError(readError.message);
  if (!before?.project_id) return { deleted: false };

  const { error } = await db
    .from("schedule_tasks")
    .delete()
    .eq("id", taskId)
    .eq("tenant_id", tenantId);
  if (error) throw new ScheduleTaskDeleteError(error.message);

  const { updated } = await recomputeProjectSchedule(db, tenantId, before.project_id);
  return { deleted: true, projectId: before.project_id, updated };
}

export async function recomputeProjectSchedule(db: AnyDb, tenantId: string, projectId: string): Promise<{ updated: number }> {
  const { data, error } = await db
    .from("schedule_tasks")
    .select("id, name, duration, start_date, end_date, deps, status, percent_complete")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  const tasks = (data ?? []) as TaskRow[];
  let results;
  try {
    results = computeCpm(tasks.map((task) => ({
      id: task.id,
      duration: durationDays(task),
      deps: task.deps ?? [],
    })));
  } catch (err) {
    if (err instanceof CpmCycleError) throw err;
    throw err;
  }
  for (const result of results) {
    const { error: updateError } = await db
      .from("schedule_tasks")
      .update({
        es: result.es,
        ef: result.ef,
        ls: result.ls,
        lf: result.lf,
        total_float: result.total_float,
        free_float: result.free_float,
        critical: result.critical,
      })
      .eq("id", result.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);
  }
  return { updated: results.length };
}

export function tasksInLookahead(tasks: Array<{ start_date: string | null; end_date: string | null }>, today: Date, days = 21): boolean[] {
  const start = today.getTime();
  const end = start + days * 86400000;
  return tasks.map((task) => {
    const taskStart = task.start_date ? new Date(task.start_date).getTime() : null;
    const taskEnd = task.end_date ? new Date(task.end_date).getTime() : taskStart;
    if (taskStart == null || taskEnd == null) return false;
    return taskStart <= end && taskEnd >= start;
  });
}
