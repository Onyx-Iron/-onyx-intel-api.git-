/**
 * Branded numeric helpers for estimate money fields.
 *
 * Convention (matches Bidwright-style separation of concerns, reimplemented):
 *   - PerUnitCost  — $ per UoM (estimate_items.unit_cost)
 *   - LineTotal    — extended dollars for the whole line (total_price)
 *   - MarkupRatio  — decimal ratio (0.15 = 15%), never a percent integer
 *
 * Brands are erased at runtime; they exist to force call sites to re-state
 * intent when crossing unit ↔ extended boundaries.
 */

declare const __PerUnitCostBrand: unique symbol;
declare const __LineTotalBrand: unique symbol;
declare const __MarkupRatioBrand: unique symbol;

export type PerUnitCost = number & { readonly [__PerUnitCostBrand]: true };
export type LineTotal = number & { readonly [__LineTotalBrand]: true };
export type MarkupRatio = number & { readonly [__MarkupRatioBrand]: true };

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function asPerUnitCost(n: number): PerUnitCost {
  return roundCurrency(Number.isFinite(n) ? n : 0) as PerUnitCost;
}

export function asLineTotal(n: number): LineTotal {
  return roundCurrency(Number.isFinite(n) ? n : 0) as LineTotal;
}

/** Markup as a decimal ratio. Values > 1 are treated as percent (15 → 0.15). */
export function asMarkupRatio(n: number): MarkupRatio {
  const v = Number.isFinite(n) ? n : 0;
  const ratio = v > 1 ? v / 100 : v;
  return (Math.round(ratio * 10000) / 10000) as MarkupRatio;
}

export const ZERO_PER_UNIT_COST = asPerUnitCost(0);
export const ZERO_LINE_TOTAL = asLineTotal(0);
export const ZERO_MARKUP = asMarkupRatio(0);

export function lineCost(cost: PerUnitCost, qty: number): LineTotal {
  const q = Number.isFinite(qty) ? qty : 0;
  return asLineTotal(cost * q);
}

export function perUnitFromLine(line: LineTotal, qty: number): PerUnitCost {
  const q = Number.isFinite(qty) && qty !== 0 ? qty : 1;
  return asPerUnitCost(line / q);
}

export function withMarkup(amount: LineTotal, markup: MarkupRatio): LineTotal {
  return asLineTotal(amount * (1 + markup));
}

export function deriveMarkup(price: LineTotal, extCost: LineTotal): MarkupRatio {
  if (extCost <= 0) return ZERO_MARKUP;
  return asMarkupRatio((price - extCost) / extCost);
}

/** Money compare epsilon — anything finer is rounding noise, not an edit. */
export const MONEY_EPSILON = 0.005;

export function moneyDiffers(a: number, b: number, epsilon = MONEY_EPSILON): boolean {
  return Math.abs(a - b) > epsilon;
}
