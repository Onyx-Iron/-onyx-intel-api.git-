import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCurrentBudget } from "./budget-store.ts";

function pageable(rows: unknown[]) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    range(from: number, to: number) {
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
    maybeSingle() {
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
  };
  return builder;
}

describe("loadCurrentBudget", () => {
  it("includes budget lines, commitments, and costs past the 1000-row cap", async () => {
    const lines = Array.from({ length: 1001 }, (_, index) => ({
      id: `line-${index}`,
      description: "Line",
      quantity: null,
      uom: null,
      source_takeoff_id: null,
      source_estimate_item_id: null,
      original_amount: index === 1000 ? 50 : 10,
      approved_change_amount: 0,
      forecast_override: null,
      total_price: index === 1000 ? 50 : 10,
      csi_code: null,
      sort_order: index,
    }));
    const commitments = Array.from({ length: 1001 }, (_, index) => ({
      id: `commit-${index}`,
      budget_line_id: "line-0",
      amount: index === 1000 ? 9 : 1,
    }));
    const actuals = Array.from({ length: 1001 }, (_, index) => ({
      id: `cost-${index}`,
      budget_line_id: index === 1000 ? null : "line-0",
      amount: index === 1000 ? 7 : 4,
    }));
    const db = {
      from(table: string) {
        if (table === "project_budgets") {
          return pageable([{ id: "budget-1", is_current: true }]);
        }
        if (table === "project_budget_lines") return pageable(lines);
        if (table === "project_commitment_lines") return pageable(commitments);
        if (table === "project_cost_entries") return pageable(actuals);
        throw new Error(`unexpected table ${table}`);
      },
    };

    const current = await loadCurrentBudget(db, "tenant-1", "project-1");
    assert.ok(current);
    assert.equal(current.lines.length, 1001);
    assert.equal(current.totals.original, 10050);
    assert.equal(current.totals.committed, 1009);
    assert.equal(current.totals.actual, 4000);
    assert.equal(current.unassigned_actual, 7);
    assert.equal(current.lines[0].committed, 1009);
    assert.equal(current.lines[0].actual, 4000);
  });
});
