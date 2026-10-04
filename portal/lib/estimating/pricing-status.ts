export type EstimatePricingStatus = "manual" | "priced" | "unpriced" | "review";

const DIRECT_COST_KEYS = [
  "labor_cost",
  "material_cost",
  "equipment_cost",
  "trucking_cost",
  "subcontract_cost",
  "disposal_cost",
] as const;

type DirectCostKey = (typeof DIRECT_COST_KEYS)[number];

export interface PricingStatusLine {
  quantity?: number | string | null;
  labor_cost?: number | string | null;
  material_cost?: number | string | null;
  equipment_cost?: number | string | null;
  trucking_cost?: number | string | null;
  subcontract_cost?: number | string | null;
  disposal_cost?: number | string | null;
  pricing_status?: string | null;
}

function money(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Unit rate when quantity is usable; otherwise the extended dollars. */
function comparableRate(
  extended: number | string | null | undefined,
  quantity: number | string | null | undefined,
): number {
  const q = money(quantity);
  const amount = money(extended);
  if (q === 0) return amount;
  return amount / q;
}

function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function knownStatus(value: string | null | undefined): EstimatePricingStatus | null {
  switch (value) {
    case "manual":
    case "priced":
    case "unpriced":
    case "review":
      return value;
    default:
      return null;
  }
}

function directRatesUnchanged(existing: PricingStatusLine, next: PricingStatusLine): boolean {
  for (const key of DIRECT_COST_KEYS) {
    const costKey: DirectCostKey = key;
    const before = comparableRate(existing[costKey], existing.quantity);
    const after = comparableRate(next[costKey], next.quantity);
    if (!sameMoney(before, after)) return false;
  }
  return true;
}

/**
 * A description, quantity, or notes edit must not clear `review` / `unpriced`.
 * Those statuses keep a national, low-confidence, or AI price out of the bid
 * until someone changes a unit rate. New rows and real rate edits are manual.
 */
export function pricingStatusAfterEdit(
  existing: PricingStatusLine | null | undefined,
  next: PricingStatusLine,
): EstimatePricingStatus {
  if (!existing) return "manual";
  if (!directRatesUnchanged(existing, next)) return "manual";
  return knownStatus(existing.pricing_status) ?? "manual";
}
