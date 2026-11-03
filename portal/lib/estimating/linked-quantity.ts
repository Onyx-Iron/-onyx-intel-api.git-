/** A line linked to a measurement keeps that quantity until the estimator unlinks it. */
export function quantityForLinkedLine(
  existingQuantity: number | null | undefined,
  submittedQuantity: number | null | undefined,
  sourceTakeoffId: string | null | undefined,
  unlinking: boolean,
): number | null | undefined {
  if (sourceTakeoffId && !unlinking) return existingQuantity;
  return submittedQuantity;
}

export const LINKED_DIRECT_COST_KEYS = [
  "labor_cost",
  "material_cost",
  "equipment_cost",
  "trucking_cost",
  "subcontract_cost",
  "disposal_cost",
  "testing_cost",
  "other_direct_cost",
] as const;

export type LinkedDirectCostKey = (typeof LINKED_DIRECT_COST_KEYS)[number];

function asMoney(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asQuantity(value: number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The estimate grid sends extended cost as typed quantity × unit rate.
 * When the linked quantity is kept, scale those extensions back so the
 * unit rate (and sell price) stay put. A cleared quantity cannot carry
 * a rate, so the stored extensions are kept instead of being zeroed.
 */
export function directCostsForKeptQuantity(
  submitted: Partial<Record<LinkedDirectCostKey, number | null | undefined>>,
  existing: Partial<Record<LinkedDirectCostKey, number | string | null | undefined>> | null | undefined,
  submittedQuantity: number | null | undefined,
  keptQuantity: number | null | undefined,
): Record<LinkedDirectCostKey, number> {
  const submittedQty = asQuantity(submittedQuantity);
  const keptQty = asQuantity(keptQuantity);
  const quantityRejected = keptQty != null && submittedQty != null && submittedQty !== keptQty;
  if (!quantityRejected) {
    return Object.fromEntries(
      LINKED_DIRECT_COST_KEYS.map((key) => [key, asMoney(submitted[key])]),
    ) as Record<LinkedDirectCostKey, number>;
  }
  if (submittedQty !== 0) {
    const factor = keptQty / submittedQty;
    return Object.fromEntries(
      LINKED_DIRECT_COST_KEYS.map((key) => [key, roundCents(asMoney(submitted[key]) * factor)]),
    ) as Record<LinkedDirectCostKey, number>;
  }
  return Object.fromEntries(
    LINKED_DIRECT_COST_KEYS.map((key) => [key, asMoney(existing?.[key])]),
  ) as Record<LinkedDirectCostKey, number>;
}
