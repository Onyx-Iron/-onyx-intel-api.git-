import { computeBudgetLine, roundMoney, sumMoney } from "@/lib/project-file/money";
import type { AnyDb } from "@/lib/project-file/api";

export interface StoredBudgetLine {
  id: string;
  description: string;
  quantity: number | null;
  uom: string | null;
  source_takeoff_id: string | null;
  source_estimate_item_id: string | null;
  original_amount: number | null;
  approved_change_amount: number | null;
  forecast_override: number | null;
  total_price: number | null;
  csi_code: string | null;
}

export async function loadCurrentBudget(db: AnyDb, tenantId: string, projectId: string) {
  const { data: budget, error } = await db
    .from("project_budgets")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!budget) return null;
  const { data: lines, error: lineError } = await db
    .from("project_budget_lines")
    .select("*")
    .eq("budget_id", budget.id)
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });
  if (lineError) throw new Error(lineError.message);
  const { data: commitments } = await db
    .from("project_commitment_lines")
    .select("budget_line_id, amount")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  const { data: actuals } = await db
    .from("project_cost_entries")
    .select("budget_line_id, amount")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);

  const committed = new Map<string, number>();
  for (const row of commitments ?? []) {
    if (!row.budget_line_id) continue;
    committed.set(row.budget_line_id, (committed.get(row.budget_line_id) ?? 0) + Number(row.amount ?? 0));
  }
  const actual = new Map<string, number>();
  let unassigned = 0;
  for (const row of actuals ?? []) {
    const amount = Number(row.amount ?? 0);
    if (!row.budget_line_id) {
      unassigned += amount;
      continue;
    }
    actual.set(row.budget_line_id, (actual.get(row.budget_line_id) ?? 0) + amount);
  }

  const computedLines = ((lines ?? []) as StoredBudgetLine[]).map((line) => {
    const original = Number(line.original_amount ?? line.total_price ?? 0);
    const math = computeBudgetLine({
      original,
      approvedChange: Number(line.approved_change_amount ?? 0),
      committed: committed.get(line.id) ?? 0,
      actual: actual.get(line.id) ?? 0,
      forecastOverride: line.forecast_override == null ? null : Number(line.forecast_override),
    });
    return {
      ...line,
      original_amount: original,
      committed: math ? (committed.get(line.id) ?? 0) : 0,
      actual: actual.get(line.id) ?? 0,
      revised: math.revised,
      forecast_to_complete: math.forecastToComplete,
      projected_final: math.projectedFinal,
      projected_margin: math.projectedMargin,
    };
  });

  const revisedTotal = sumMoney(computedLines.map((line) => line.revised));
  return {
    budget,
    lines: computedLines,
    unassigned_actual: roundMoney(unassigned),
    totals: {
      original: sumMoney(computedLines.map((line) => Number(line.original_amount))),
      approved_change: sumMoney(computedLines.map((line) => Number(line.approved_change_amount ?? 0))),
      revised: revisedTotal,
      committed: sumMoney(computedLines.map((line) => line.committed)),
      actual: sumMoney(computedLines.map((line) => line.actual)),
      forecast_to_complete: sumMoney(computedLines.map((line) => line.forecast_to_complete)),
      projected_final: sumMoney(computedLines.map((line) => line.projected_final)),
      projected_margin: sumMoney(computedLines.map((line) => line.projected_margin)),
    },
  };
}

export async function syncProjectBudgetHeader(db: AnyDb, tenantId: string, projectId: string): Promise<number> {
  const current = await loadCurrentBudget(db, tenantId, projectId);
  const revised = current?.totals.revised ?? 0;
  await db.from("projects").update({ budget: revised, updated_at: new Date().toISOString() }).eq("id", projectId).eq("tenant_id", tenantId);
  return revised;
}

const APPROVED_CHANGE_ATTEMPTS = 5;

export async function addApprovedChange(
  db: AnyDb,
  tenantId: string,
  projectId: string,
  allocations: Array<{ budgetLineId: string; amount: number }>,
): Promise<void> {
  for (const allocation of allocations) {
    if (!allocation.budgetLineId || !Number.isFinite(allocation.amount) || allocation.amount === 0) continue;
    let applied = false;
    for (let attempt = 0; attempt < APPROVED_CHANGE_ATTEMPTS; attempt++) {
      const { data: line, error } = await db
        .from("project_budget_lines")
        .select("id, approved_change_amount")
        .eq("id", allocation.budgetLineId)
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!line) {
        applied = true;
        break;
      }
      const current = Number(line.approved_change_amount ?? 0);
      const next = roundMoney(current + allocation.amount);
      const { data: updated, error: updateError } = await db
        .from("project_budget_lines")
        .update({ approved_change_amount: next })
        .eq("id", line.id)
        .eq("tenant_id", tenantId)
        .eq("approved_change_amount", line.approved_change_amount)
        .select("id");
      if (updateError) throw new Error(updateError.message);
      if (Array.isArray(updated) && updated.length > 0) {
        applied = true;
        break;
      }
    }
    if (!applied) {
      throw new Error(`Could not post the approved change onto budget line ${allocation.budgetLineId}`);
    }
  }
  await syncProjectBudgetHeader(db, tenantId, projectId);
}
