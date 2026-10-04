export interface CpmTaskInput {
  id: string;
  duration: number;
  deps: string[];
}

export interface CpmTaskResult {
  id: string;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  total_float: number;
  free_float: number;
  critical: boolean;
}

export class CpmCycleError extends Error {
  constructor() {
    super("Schedule dependencies contain a cycle");
    this.name = "CpmCycleError";
  }
}

/** Finish-to-start CPM. Duration is in days. Missing predecessor ids are ignored. */
export function computeCpm(tasks: CpmTaskInput[]): CpmTaskResult[] {
  const ids = new Set(tasks.map((task) => task.id));
  const normalized = tasks.map((task) => ({
    id: task.id,
    duration: Number.isFinite(task.duration) && task.duration > 0 ? task.duration : 1,
    deps: [...new Set(task.deps.filter((id) => id !== task.id && ids.has(id)))],
  }));

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const remaining = new Map(normalized.map((task) => [task.id, task.deps.length]));
  const queue = normalized.filter((task) => task.deps.length === 0).map((task) => task.id);
  const order: string[] = [];
  const successors = new Map<string, string[]>();
  for (const task of normalized) successors.set(task.id, []);
  for (const task of normalized) {
    for (const dep of task.deps) successors.get(dep)?.push(task.id);
  }

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    order.push(id);
    const task = normalized.find((row) => row.id === id);
    if (!task) continue;
    const start = task.deps.reduce((max, dep) => Math.max(max, ef.get(dep) ?? 0), 0);
    es.set(id, start);
    ef.set(id, start + task.duration);
    for (const next of successors.get(id) ?? []) {
      const left = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  if (order.length !== normalized.length) throw new CpmCycleError();

  const projectFinish = normalized.reduce((max, task) => Math.max(max, ef.get(task.id) ?? 0), 0);
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const task = normalized.find((row) => row.id === id);
    if (!task) continue;
    const nexts = successors.get(id) ?? [];
    const finish = nexts.length === 0
      ? projectFinish
      : Math.min(...nexts.map((next) => ls.get(next) ?? projectFinish));
    lf.set(id, finish);
    ls.set(id, finish - task.duration);
  }

  return normalized.map((task) => {
    const start = es.get(task.id) ?? 0;
    const finish = ef.get(task.id) ?? start;
    const lateStart = ls.get(task.id) ?? start;
    const lateFinish = lf.get(task.id) ?? finish;
    const totalFloat = lateStart - start;
    const nexts = successors.get(task.id) ?? [];
    const freeFloat = nexts.length === 0
      ? projectFinish - finish
      : Math.min(...nexts.map((next) => es.get(next) ?? finish)) - finish;
    return {
      id: task.id,
      es: start,
      ef: finish,
      ls: lateStart,
      lf: lateFinish,
      total_float: totalFloat,
      free_float: freeFloat,
      critical: totalFloat === 0,
    };
  });
}

export function durationDays(task: {
  duration?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}): number {
  if (task.duration != null && task.duration > 0) return task.duration;
  if (task.start_date && task.end_date) {
    const diff = (new Date(task.end_date).getTime() - new Date(task.start_date).getTime()) / 86400000;
    if (Number.isFinite(diff) && diff > 0) return Math.round(diff);
  }
  return 1;
}

/** Shift a task's calendar dates by whole days. Dates stay null when unset. */
export function shiftTaskDates(
  task: { start_date: string | null; end_date: string | null },
  days: number,
): { start_date: string | null; end_date: string | null } {
  const shift = (value: string | null) => {
    if (!value || days === 0) return value;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return { start_date: shift(task.start_date), end_date: shift(task.end_date) };
}
