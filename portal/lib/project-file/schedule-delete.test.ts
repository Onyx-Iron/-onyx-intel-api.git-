import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deleteScheduleTask } from "./schedule-store.ts";

interface TaskRow {
  id: string;
  tenant_id: string;
  project_id: string;
  name: string;
  duration: number;
  start_date: string | null;
  end_date: string | null;
  deps: string[];
  status: string;
  percent_complete: number | null;
  total_float: number | null;
  critical: boolean;
}

function matches(row: TaskRow, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);
}

function makeDb(tasks: TaskRow[]) {
  return {
    from(table: string) {
      if (table !== "schedule_tasks") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            maybeSingle() {
              const row = tasks.find((task) => matches(task, filters)) ?? null;
              return Promise.resolve({ data: row, error: null });
            },
            then(resolve: (value: { data: TaskRow[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
              return Promise.resolve({
                data: tasks.filter((task) => matches(task, filters)),
                error: null,
              }).then(resolve, reject);
            },
          };
          return chain;
        },
        delete() {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
              for (let i = tasks.length - 1; i >= 0; i -= 1) {
                if (matches(tasks[i], filters)) tasks.splice(i, 1);
              }
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return chain;
        },
        update(patch: Partial<TaskRow>) {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
              const row = tasks.find((task) => matches(task, filters));
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },
  };
}

describe("deleteScheduleTask", () => {
  it("recomputes float after the driving activity is removed", async () => {
    const tasks: TaskRow[] = [
      {
        id: "drive",
        tenant_id: "tenant-1",
        project_id: "project-1",
        name: "Drive the finish",
        duration: 10,
        start_date: null,
        end_date: null,
        deps: [],
        status: "in_progress",
        percent_complete: null,
        total_float: 0,
        critical: true,
      },
      {
        id: "short",
        tenant_id: "tenant-1",
        project_id: "project-1",
        name: "Short activity",
        duration: 2,
        start_date: null,
        end_date: null,
        deps: [],
        status: "in_progress",
        percent_complete: null,
        total_float: 8,
        critical: false,
      },
    ];

    const result = await deleteScheduleTask(makeDb(tasks), "tenant-1", "drive");
    assert.deepEqual(result, { deleted: true, projectId: "project-1", updated: 1 });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.id, "short");
    assert.equal(tasks[0]?.critical, true);
    assert.equal(tasks[0]?.total_float, 0);
  });

  it("does not recompute a missing task", async () => {
    const tasks: TaskRow[] = [];
    const result = await deleteScheduleTask(makeDb(tasks), "tenant-1", "missing");
    assert.deepEqual(result, { deleted: false });
  });
});
