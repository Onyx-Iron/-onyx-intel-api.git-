import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addApprovedChange } from "./budget-store.ts";

interface Line {
  id: string;
  tenant_id: string;
  project_id: string;
  approved_change_amount: number;
}

/**
 * A second writer commits between this call's read and its update, the way
 * two change-event approvals on one budget line overlap.
 */
function fakeDb(line: Line, options: { interfereOnce?: boolean } = {}) {
  let interfere = options.interfereOnce === true;
  const projects: Array<Record<string, unknown>> = [];

  function matches(row: Record<string, unknown>, filters: Array<[string, unknown]>): boolean {
    return filters.every(([col, val]) => row[col] === val);
  }

  function chain(table: string, op: "select" | "update", payload?: Record<string, unknown>) {
    const filters: Array<[string, unknown]> = [];
    const api = {
      select() { return api; },
      eq(col: string, val: unknown) { filters.push([col, val]); return api; },
      order() { return api; },
      maybeSingle() {
        return Promise.resolve(api.result());
      },
      then(resolve: (value: { data: unknown; error: null }) => void) {
        resolve(api.result());
      },
      result(): { data: unknown; error: null } {
        if (table === "project_budgets") return { data: null, error: null };
        if (table === "projects" && op === "update") {
          projects.push({ ...(payload ?? {}) });
          return { data: null, error: null };
        }
        if (table !== "project_budget_lines") return { data: op === "select" ? [] : null, error: null };
        if (op === "select") {
          const row = matches(line as unknown as Record<string, unknown>, filters) ? line : null;
          return { data: row, error: null };
        }
        if (interfere) {
          line.approved_change_amount = 400;
          interfere = false;
        }
        if (!matches(line as unknown as Record<string, unknown>, filters)) {
          return { data: [], error: null };
        }
        Object.assign(line, payload);
        return { data: [{ id: line.id }], error: null };
      },
    };
    return api;
  }

  return {
    projects,
    from(table: string) {
      return {
        select() { return chain(table, "select"); },
        update(payload: Record<string, unknown>) { return chain(table, "update", payload); },
      };
    },
  };
}

describe("addApprovedChange", () => {
  it("adds the allocation onto the current approved change", async () => {
    const line: Line = {
      id: "line-1",
      tenant_id: "tenant-1",
      project_id: "project-1",
      approved_change_amount: 1000,
    };
    const db = fakeDb(line);
    await addApprovedChange(db, "tenant-1", "project-1", [{ budgetLineId: "line-1", amount: 250 }]);
    assert.equal(line.approved_change_amount, 1250);
  });

  it("retries when another approval writes the same budget line first", async () => {
    const line: Line = {
      id: "line-1",
      tenant_id: "tenant-1",
      project_id: "project-1",
      approved_change_amount: 0,
    };
    const db = fakeDb(line, { interfereOnce: true });
    await addApprovedChange(db, "tenant-1", "project-1", [{ budgetLineId: "line-1", amount: 100 }]);
    assert.equal(line.approved_change_amount, 500);
  });
});
