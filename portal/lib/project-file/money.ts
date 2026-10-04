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

/** Only a newly approved change order moves the revised budget. */
export function approvedChangeDelta(previousStatus: string, nextStatus: string, amount: number): number {
  if (nextStatus !== "approved") return 0;
  if (previousStatus === "approved") return 0;
  return amount;
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
