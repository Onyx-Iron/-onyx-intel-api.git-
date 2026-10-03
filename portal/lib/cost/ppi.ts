/**
 * Pure PPI / commodity-index aging helpers.
 *
 * Estimators resolve prices from cost_prices / overrides. The monthly Edge
 * job writes commodity_trend_series (and may mutate stale overrides), but
 * national/regional catalog rows were never aged at read time — so PPI had
 * no effect on what resolveCost returned. These helpers apply a 90-day
 * percent change when the underlying observation is stale.
 */

export const PPI_STALE_AFTER_DAYS = 90;

/** Leading two-digit CSI MasterFormat division from a cost code. */
export function csiDivisionFromCode(csiCode: string | null | undefined): string | null {
  const m = (csiCode ?? "").trim().match(/^(\d{2})/);
  return m ? m[1] : null;
}

export function ageInDays(observedAt: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (observedAt == null) return null;
  const t = observedAt instanceof Date ? observedAt.getTime() : Date.parse(observedAt);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / (24 * 60 * 60 * 1000);
}

export interface EscalateInput {
  unitCost: number;
  observedAt?: string | Date | null;
  /** CSI code or already-normalized two-digit division */
  csiCodeOrDivision: string | null | undefined;
  /** division → 90-day percent change (e.g. 3.5 means +3.5%) */
  pctChangeByDivision: ReadonlyMap<string, number>;
  staleAfterDays?: number;
  now?: Date;
}

export interface EscalateResult {
  unitCost: number;
  escalated: boolean;
  pctApplied: number | null;
  division: string | null;
}

/**
 * Age a stale unit cost by its CSI division's commodity PPI delta.
 * Fresh prices, missing trends, or non-positive costs are returned unchanged.
 */
export function escalateStaleUnitCost(input: EscalateInput): EscalateResult {
  const unitCost = Number(input.unitCost);
  const division =
    csiDivisionFromCode(input.csiCodeOrDivision) ??
    ((input.csiCodeOrDivision ?? "").trim().length === 2 ? (input.csiCodeOrDivision as string).trim() : null);

  if (!Number.isFinite(unitCost) || unitCost <= 0 || !division) {
    return { unitCost: Number.isFinite(unitCost) ? unitCost : 0, escalated: false, pctApplied: null, division };
  }

  const age = ageInDays(input.observedAt, input.now);
  const staleAfter = input.staleAfterDays ?? PPI_STALE_AFTER_DAYS;
  if (age == null || age < staleAfter) {
    return { unitCost, escalated: false, pctApplied: null, division };
  }

  const pct = input.pctChangeByDivision.get(division);
  if (pct == null || !Number.isFinite(pct) || pct === 0) {
    return { unitCost, escalated: false, pctApplied: null, division };
  }

  const next = Math.round(unitCost * (1 + pct / 100) * 100) / 100;
  if (next === unitCost) {
    return { unitCost, escalated: false, pctApplied: pct, division };
  }
  return { unitCost: next, escalated: true, pctApplied: pct, division };
}

/** Scale an optional money component by the same factor as the unit cost. */
export function scaleOptionalCost(
  value: number | null | undefined,
  fromUnit: number,
  toUnit: number,
): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (!Number.isFinite(fromUnit) || fromUnit === 0 || fromUnit === toUnit) return Number(value);
  return Math.round(Number(value) * (toUnit / fromUnit) * 100) / 100;
}
