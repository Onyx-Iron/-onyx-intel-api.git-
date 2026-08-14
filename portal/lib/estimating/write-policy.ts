export type EstimateItemIdentityResult =
  | { valid: true; id: string; existing: boolean }
  | { valid: false; reason: "item_not_in_version" };

/** Prevent a service-role upsert from adopting an id owned by another version or tenant. */
export function resolveEstimateItemId(
  requestedId: string | null | undefined,
  existingVersionItemIds: ReadonlySet<string>,
  createId: () => string = () => crypto.randomUUID(),
): EstimateItemIdentityResult {
  if (!requestedId) return { valid: true, id: createId(), existing: false };
  if (!existingVersionItemIds.has(requestedId)) return { valid: false, reason: "item_not_in_version" };
  return { valid: true, id: requestedId, existing: true };
}

export function validateEstimateRowVersion(submitted: number | null | undefined, current: number): boolean {
  return Number.isInteger(submitted) && submitted === current;
}

const PRICING_BASIS_FIELDS = [
  "cost_code", "quantity", "uom", "labor_cost", "material_cost", "equipment_cost",
  "trucking_cost", "subcontract_cost", "disposal_cost", "testing_cost",
  "other_direct_cost", "indirect_cost",
] as const;

/** Any manual change to the priced basis makes the attached source snapshot stale. */
export function hasPricingBasisChanged(
  existing: Record<string, unknown>,
  submitted: Record<string, unknown>,
): boolean {
  return PRICING_BASIS_FIELDS.some((field) => {
    const before = existing[field];
    const after = submitted[field];
    if (typeof before === "number" || typeof after === "number") return Number(before ?? 0) !== Number(after ?? 0);
    return String(before ?? "") !== String(after ?? "");
  });
}

const NON_NEGATIVE_FIELDS = [
  "quantity",
  "labor_cost",
  "material_cost",
  "equipment_cost",
  "trucking_cost",
  "subcontract_cost",
  "disposal_cost",
  "testing_cost",
  "other_direct_cost",
  "indirect_cost",
  "contingency",
  "overhead",
  "profit",
  "contingency_pct",
  "overhead_pct",
  "profit_pct",
] as const;

export function validateEstimateWriteNumbers(input: Record<string, unknown>):
  { valid: true } | { valid: false; field: typeof NON_NEGATIVE_FIELDS[number] } {
  for (const field of NON_NEGATIVE_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return { valid: false, field };
  }
  return { valid: true };
}
