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
