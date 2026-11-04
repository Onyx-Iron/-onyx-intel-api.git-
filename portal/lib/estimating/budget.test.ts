import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BudgetPublishError, publishApprovedBudget, snapshotBudget, type BudgetSnapshot } from "./budget.ts";

describe("approved estimate budget snapshot", () => {
  it("copies the supplied lines and their prices", () => {
    const snapshot = snapshotBudget([
      {
        id: "item-1",
        source_takeoff_id: "takeoff-1",
        csi_code: "22-11-16",
        description: "Copper pipe",
        quantity: 10,
        uom: "LF",
        labor_cost: 220,
        material_cost: 240,
        equipment_cost: 20,
        total_price: 480,
        sort_order: 1,
      },
    ]);
    assert.equal(snapshot.lineCount, 1);
    assert.equal(snapshot.totalPrice, 480);
    assert.equal(snapshot.lines[0].labor_cost, 220);
    assert.equal(snapshot.lines[0].material_cost, 240);
    assert.equal(snapshot.lines[0].source_estimate_item_id, "item-1");
  });
});

interface BudgetHeader {
  id: string;
  tenant_id: string;
  project_id: string;
  source_estimate_version_id: string;
  version_number: number;
  total_price: number;
  line_count: number;
  created_by: string;
  is_current: boolean;
}

interface BudgetLine {
  budget_id: string;
  tenant_id: string;
  project_id: string;
  description: string;
  total_price: number;
  original_amount: number;
  sort_order: number;
}

interface ProjectRow {
  id: string;
  tenant_id: string;
  budget: number | null;
}

function matches(row: Record<string, unknown>, filters: Array<[string, string, unknown]>): boolean {
  for (const [op, col, val] of filters) {
    if (op === "eq" && row[col] !== val) return false;
    if (op === "neq" && row[col] === val) return false;
  }
  return true;
}

function createFakeDb(options?: { failLines?: boolean; missFirstVersionRead?: boolean }) {
  const budgets: BudgetHeader[] = [{
    id: "budget-old",
    tenant_id: "tenant-1",
    project_id: "project-1",
    source_estimate_version_id: "version-old",
    version_number: 1,
    total_price: 900,
    line_count: 1,
    created_by: "user-1",
    is_current: true,
  }];
  const lines: BudgetLine[] = [];
  const projects: ProjectRow[] = [{ id: "project-1", tenant_id: "tenant-1", budget: 900 }];
  const ops: string[] = [];
  let ids = 0;
  let missedVersionRead = false;

  function rowsFor(table: string): Array<Record<string, unknown>> {
    if (table === "project_budgets") return budgets;
    if (table === "project_budget_lines") return lines;
    return projects;
  }

  function from(table: string) {
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
    const filters: Array<[string, string, unknown]> = [];
    const run = () => {
      const matched = () => rowsFor(table).filter((row) => matches(row, filters));
      if (mode === "select") {
        if (
          options?.missFirstVersionRead
          && !missedVersionRead
          && table === "project_budgets"
          && filters.some(([op, col]) => op === "eq" && col === "source_estimate_version_id")
        ) {
          missedVersionRead = true;
          return { data: [], error: null };
        }
        return { data: matched(), error: null };
      }
      if (mode === "insert") {
        const incoming = Array.isArray(payload) ? payload : [payload ?? {}];
        if (table === "project_budget_lines" && options?.failLines) {
          ops.push("insert project_budget_lines");
          return { data: null, error: { message: "line insert failed" } };
        }
        if (table === "project_budgets") {
          const row = incoming[0] as unknown as BudgetHeader;
          if (budgets.some((budget) => budget.source_estimate_version_id === row.source_estimate_version_id)) {
            ops.push("insert project_budgets conflict");
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          budgets.push({ ...row, id: row.id ?? `budget-${++ids}` });
          ops.push(`insert project_budgets current=${String(row.is_current)}`);
          return { data: [budgets[budgets.length - 1]], error: null };
        }
        lines.push(...(incoming as unknown as BudgetLine[]));
        ops.push("insert project_budget_lines");
        return { data: incoming, error: null };
      }
      if (mode === "update") {
        ops.push(`update ${table}`);
        for (const row of matched()) Object.assign(row, payload);
        return { data: matched(), error: null };
      }
      ops.push(`delete ${table}`);
      const doomed = new Set(matched());
      if (table === "project_budgets") {
        for (let i = budgets.length - 1; i >= 0; i -= 1) {
          if (doomed.has(budgets[i])) budgets.splice(i, 1);
        }
      }
      return { data: null, error: null };
    };
    const one = (kind: "single" | "maybe") => {
      const result = run();
      if (result.error) return { data: null, error: result.error };
      const rows = (result.data ?? []) as unknown[];
      if (kind === "maybe" && rows.length > 1) return { data: null, error: { message: "multiple rows" } };
      if (kind === "single" && rows.length !== 1) return { data: null, error: { message: "expected one row" } };
      return { data: rows[0] ?? null, error: null };
    };
    const api = {
      select() { return api; },
      insert(row: Record<string, unknown> | Array<Record<string, unknown>>) { mode = "insert"; payload = row; return api; },
      update(row: Record<string, unknown>) { mode = "update"; payload = row; return api; },
      delete() { mode = "delete"; return api; },
      eq(col: string, val: unknown) { filters.push(["eq", col, val]); return api; },
      neq(col: string, val: unknown) { filters.push(["neq", col, val]); return api; },
      order() { return api; },
      maybeSingle() { return Promise.resolve(one("maybe")); },
      single() { return Promise.resolve(one("single")); },
      then(resolve: (value: { data: unknown; error: { message: string } | null }) => void, reject?: (reason: unknown) => void) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return api;
  }

  return { from, budgets, lines, projects, ops };
}

const sampleSnapshot: BudgetSnapshot = snapshotBudget([{
  id: "item-1",
  description: "Copper pipe",
  total_price: 480,
  sort_order: 1,
}]);

describe("publish approved budget", () => {
  const args = {
    tenantId: "tenant-1",
    projectId: "project-1",
    versionId: "version-2",
    versionNumber: 2,
    userId: "user-1",
    snapshot: sampleSnapshot,
  };

  it("keeps the previous budget current until the new lines are stored", async () => {
    const db = createFakeDb();
    const published = await publishApprovedBudget(db, args);
    assert.equal(published.created, true);
    assert.equal(published.lines.length, 1);
    assert.equal(published.lines[0].original_amount, 480);
    const lineAt = db.ops.indexOf("insert project_budget_lines");
    const demoteAt = db.ops.indexOf("update project_budgets");
    assert.ok(lineAt >= 0 && demoteAt > lineAt);
    assert.equal(db.ops[0], "insert project_budgets current=false");
    assert.equal(db.budgets.find((row) => row.id === "budget-old")?.is_current, false);
    assert.equal(db.budgets.find((row) => row.source_estimate_version_id === "version-2")?.is_current, true);
    assert.equal(db.projects[0].budget, 480);
  });

  it("leaves the live budget in place when the new lines fail", async () => {
    const db = createFakeDb({ failLines: true });
    await assert.rejects(() => publishApprovedBudget(db, args), BudgetPublishError);
    assert.equal(db.budgets.some((row) => row.source_estimate_version_id === "version-2"), false);
    assert.equal(db.budgets.find((row) => row.id === "budget-old")?.is_current, true);
    assert.equal(db.projects[0].budget, 900);
    assert.equal(db.ops.includes("update project_budgets"), false);
  });

  it("does not clear the live budget when the version was already saved", async () => {
    const db = createFakeDb({ missFirstVersionRead: true });
    db.budgets.push({
      id: "budget-raced",
      tenant_id: "tenant-1",
      project_id: "project-1",
      source_estimate_version_id: "version-2",
      version_number: 2,
      total_price: 480,
      line_count: 1,
      created_by: "user-1",
      is_current: false,
    });
    const published = await publishApprovedBudget(db, args);
    assert.equal(published.created, false);
    assert.equal(published.budget.id, "budget-raced");
    assert.equal(db.budgets.find((row) => row.id === "budget-old")?.is_current, true);
    assert.equal(db.ops.includes("update project_budgets"), false);
    assert.equal(db.projects[0].budget, 900);
  });

  it("restores a saved budget when nothing is current", async () => {
    const db = createFakeDb();
    db.budgets[0].is_current = false;
    db.budgets.push({
      id: "budget-saved",
      tenant_id: "tenant-1",
      project_id: "project-1",
      source_estimate_version_id: "version-2",
      version_number: 2,
      total_price: 480,
      line_count: 1,
      created_by: "user-1",
      is_current: false,
    });
    db.lines.push({
      budget_id: "budget-saved",
      tenant_id: "tenant-1",
      project_id: "project-1",
      description: "Copper pipe",
      total_price: 480,
      original_amount: 480,
      sort_order: 1,
    });
    const published = await publishApprovedBudget(db, args);
    assert.equal(published.created, false);
    assert.equal(published.budget.is_current, true);
    assert.equal(db.lines.length, 1);
    assert.equal(db.projects[0].budget, 480);
  });
});
