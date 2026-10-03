import { allocateDirectCosts } from "../../supabase/functions/_shared/estimate-sync-contract";

export interface SeedCostSource {
  unit_cost: number;
  source: string;
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
}

/**
 * Direct costs for a seeded estimate line.
 * A catalog labor/material/equipment split is used only when the resolver
 * actually returned one. A flat unit price — from the catalog or from the
 * takeoff row — is booked entirely as material. No split is invented.
 */
export function seedLineCosts(
  quantity: number,
  takeoffUnitCost: number | null,
  resolved: SeedCostSource | null,
): {
  labor_cost: number;
  material_cost: number;
  equipment_cost: number;
  unit_cost: number | null;
  pricing_status: "priced" | "unpriced";
} {
  const qty = Number.isFinite(quantity) ? quantity : 0;
  const resolvedUnit = resolved && resolved.source !== "none" && resolved.unit_cost > 0
    ? resolved.unit_cost
    : null;
  const takeoffUnit = takeoffUnitCost != null && Number.isFinite(takeoffUnitCost) && takeoffUnitCost > 0
    ? takeoffUnitCost
    : null;
  const unitCost = resolvedUnit ?? takeoffUnit;
  if (unitCost == null) {
    return {
      labor_cost: 0,
      material_cost: 0,
      equipment_cost: 0,
      unit_cost: null,
      pricing_status: "unpriced",
    };
  }

  const hasSplit = resolvedUnit != null && resolved != null && (
    resolved.labor_cost != null || resolved.material_cost != null || resolved.equipment_cost != null
  );
  const allocated = allocateDirectCosts(
    qty,
    unitCost,
    hasSplit && resolved
      ? {
          labor: resolved.labor_cost ?? 0,
          material: resolved.material_cost ?? 0,
          equipment: resolved.equipment_cost ?? 0,
        }
      : null,
  );
  return {
    labor_cost: allocated.laborCost,
    material_cost: allocated.materialCost,
    equipment_cost: allocated.equipmentCost,
    unit_cost: unitCost,
    pricing_status: "priced",
  };
}

const LEGACY_LABOR_SHARE = 0.4;
const LEGACY_MATERIAL_SHARE = 0.45;
const LEGACY_EQUIPMENT_SHARE = 0.15;

/**
 * True when a saved line still carries the retired seed split
 * (labor 40% / material 45% / equipment 15% of unit × quantity).
 * A catalog line that happens to use the same shares is repriced from
 * the catalog; a flat price is not matched because equipment and labor
 * are zero.
 */
export function isLegacyHeuristicSplit(
  labor: number,
  material: number,
  equipment: number,
): boolean {
  if (![labor, material, equipment].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const total = labor + material + equipment;
  if (!(total > 0) || labor <= 0 || material <= 0 || equipment <= 0) return false;
  const tolerance = 0.01;
  return Math.abs(labor / total - LEGACY_LABOR_SHARE) <= tolerance
    && Math.abs(material / total - LEGACY_MATERIAL_SHARE) <= tolerance
    && Math.abs(equipment / total - LEGACY_EQUIPMENT_SHARE) <= tolerance;
}

/** Unit price implied by a legacy 40/45/15 extended split, or null. */
export function legacyHeuristicUnitCost(
  labor: number,
  material: number,
  equipment: number,
  quantity: number,
): number | null {
  if (!isLegacyHeuristicSplit(labor, material, equipment)) return null;
  if (!(quantity > 0) || !Number.isFinite(quantity)) return null;
  return (labor + material + equipment) / quantity;
}
