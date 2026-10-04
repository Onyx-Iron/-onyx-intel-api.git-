export interface BudgetLineAmounts {
  original: number;
  approvedChange: number;
  committed: number;
  actual: number;
  forecastOverride: number | null;
}

export interface BudgetLineComputed {
  revised: number;
  forecastToComplete: number;
  projectedFinal: number;
  projectedMargin: number;
}

export function revisedBudget(original: number, approvedChange: number): number {
  return original + approvedChange;
}

/**
 * Forecast to complete defaults to what is left after actuals and commitments.
 * An override replaces that default. Draft change orders do not belong in approvedChange.
 */
export function computeBudgetLine(amounts: BudgetLineAmounts): BudgetLineComputed {
  const revised = revisedBudget(amounts.original, amounts.approvedChange);
  const forecastToComplete = amounts.forecastOverride != null
    ? amounts.forecastOverride
    : Math.max(0, revised - amounts.actual - amounts.committed);
  const projectedFinal = amounts.actual + amounts.committed + forecastToComplete;
  return {
    revised,
    forecastToComplete,
    projectedFinal,
    projectedMargin: revised - projectedFinal,
  };
}

/**
 * Net budget movement for one change order. Entering approved posts the
 * amount, leaving approved removes it, and an amount edit while it stays
 * approved posts only the difference. `previousAmount` defaults to `amount`
 * so a status-only change does not look like an amount edit.
 */
export function approvedChangeDelta(
  previousStatus: string,
  nextStatus: string,
  amount: number,
  previousAmount?: number,
): number {
  const prior = previousStatus === "approved" ? (previousAmount ?? amount) : 0;
  const posted = nextStatus === "approved" ? amount : 0;
  return roundMoney(posted - prior);
}

export interface ChangeOrderBudgetState {
  status: string;
  amount: number;
}

export interface ChangeOrderBudgetWeight {
  budgetLineId: string;
  amount: number;
}

/**
 * Per-line revised-budget delta for a change order status or amount change.
 * Event lines keep the weights they were approved with. With no event lines,
 * the posted amount is split evenly across the linked budget lines.
 */
export function changeOrderBudgetDelta(
  previous: ChangeOrderBudgetState,
  next: ChangeOrderBudgetState,
  linkedBudgetLineIds: string[],
  eventLines: ChangeOrderBudgetWeight[],
): Array<{ budgetLineId: string; amount: number }> {
  const movement = approvedChangeDelta(previous.status, next.status, next.amount, previous.amount);
  if (movement === 0 && (previous.status === "approved") === (next.status === "approved")) {
    return [];
  }
  const weights = budgetWeights(linkedBudgetLineIds, eventLines);
  const before = distributePosted(previous.status === "approved" ? previous.amount : 0, weights);
  const after = distributePosted(next.status === "approved" ? next.amount : 0, weights);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const deltas: Array<{ budgetLineId: string; amount: number }> = [];
  for (const id of ids) {
    const amount = roundMoney((after.get(id) ?? 0) - (before.get(id) ?? 0));
    if (amount !== 0) deltas.push({ budgetLineId: id, amount });
  }
  return deltas;
}

function budgetWeights(
  linkedBudgetLineIds: string[],
  eventLines: ChangeOrderBudgetWeight[],
): Array<{ id: string; weight: number }> {
  const fromEvent = new Map<string, number>();
  let sawEventLine = false;
  for (const line of eventLines) {
    if (!line.budgetLineId) continue;
    sawEventLine = true;
    if (!Number.isFinite(line.amount) || line.amount === 0) continue;
    fromEvent.set(line.budgetLineId, (fromEvent.get(line.budgetLineId) ?? 0) + line.amount);
  }
  if (sawEventLine) {
    return [...fromEvent.entries()].map(([id, weight]) => ({ id, weight }));
  }
  return [...new Set(linkedBudgetLineIds.filter(Boolean))].map((id) => ({ id, weight: 1 }));
}

function distributePosted(posted: number, weights: Array<{ id: string; weight: number }>): Map<string, number> {
  const map = new Map<string, number>();
  if (posted === 0 || weights.length === 0) return map;
  const base = weights.reduce((sum, line) => sum + line.weight, 0);
  if (base === 0) return map;
  let assigned = 0;
  weights.forEach((line, index) => {
    const portion = index === weights.length - 1
      ? roundMoney(posted - assigned)
      : roundMoney(posted * (line.weight / base));
    assigned = roundMoney(assigned + portion);
    map.set(line.id, roundMoney((map.get(line.id) ?? 0) + portion));
  });
  return map;
}

export function eventPostsBudget(status: string): boolean {
  return status === "approved";
}

export interface PayLineInput {
  scheduledValue: number;
  previous: number;
  thisPeriod: number;
  storedMaterials: number;
  retainagePct: number;
}

export interface PayLineResult {
  completed: number;
  retainage: number;
  balance: number;
}

export function retainageRate(retainagePct: number): number {
  const pct = retainagePct > 1 ? retainagePct / 100 : retainagePct;
  return Number.isFinite(pct) ? Math.max(0, pct) : 0;
}

export function computePayLine(input: PayLineInput): PayLineResult {
  const completed = input.previous + input.thisPeriod + input.storedMaterials;
  const pct = retainageRate(input.retainagePct);
  return {
    completed,
    retainage: roundMoney(completed * pct),
    balance: roundMoney(input.scheduledValue - completed),
  };
}

export interface PayAppDrawLine {
  previous: number;
  thisPeriod: number;
  storedMaterials: number;
}

export interface PayAppInvoiceTotals {
  /** This-period work plus stored materials. */
  amount: number;
  /** Holdback on this draw, not the cumulative retainage. */
  retainage: number;
}

/** Invoice figures for one pay application. Stored materials are part of the draw. */
export function payAppInvoiceTotals(lines: PayAppDrawLine[], retainagePct: number): PayAppInvoiceTotals {
  const rate = retainageRate(retainagePct);
  let amount = 0;
  let retainage = 0;
  for (const line of lines) {
    const previous = Number(line.previous) || 0;
    const thisPeriod = Number(line.thisPeriod) || 0;
    const stored = Number(line.storedMaterials) || 0;
    amount += thisPeriod + stored;
    const now = roundMoney((previous + thisPeriod + stored) * rate);
    const before = roundMoney(previous * rate);
    retainage += now - before;
  }
  return { amount: roundMoney(amount), retainage: roundMoney(retainage) };
}

/** True once this change order has already moved the revised budget. */
export function budgetAlreadyPosted(meta: unknown): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return (meta as { budget_posted?: unknown }).budget_posted === true;
}

export function withBudgetPosted(meta: unknown): Record<string, unknown> {
  const base = meta && typeof meta === "object" && !Array.isArray(meta)
    ? { ...(meta as Record<string, unknown>) }
    : {};
  base.budget_posted = true;
  return base;
}

export interface WaiverCoverInput {
  status: string;
  amount: number | null;
  draw_number: string | null;
}

/** A pay app becomes payable only when received waivers cover this draw. */
export function waiverCoversDraw(
  waivers: WaiverCoverInput[],
  drawNumber: string | null,
  drawAmount: number,
): boolean {
  if (drawAmount < 0) return false;
  const received = waivers.filter((waiver) => waiver.status === "received");
  const matching = received.filter((waiver) =>
    !drawNumber || waiver.draw_number == null || waiver.draw_number === drawNumber,
  );
  const covered = matching.reduce((sum, waiver) => sum + (waiver.amount ?? 0), 0);
  return covered + 0.009 >= drawAmount;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((sum, value) => sum + value, 0));
}
