// Shared by the Next.js estimate sync and the Deno page-takeoff worker.
// No runtime imports — both bundles can load this file.

export interface TakeoffSyncIdentity {
  label?: string | null;
  csi_code?: string | null;
  quantity?: number | null;
  unit?: string | null;
  meta?: {
    drawing_ref?: string | null;
    location_tag?: string | null;
  } | null;
}

export interface UnitCostBreakdown {
  labor: number;
  material: number;
  equipment: number;
}

export function blocksEstimateImport(reviewStatus: string | null | undefined): boolean {
  return reviewStatus === "suggested" || reviewStatus === "reviewed" || reviewStatus === "rejected";
}

export function pricingStatus(
  aiVision: boolean,
  unitCost: number | null,
): "review" | "priced" | "unpriced" {
  if (aiVision) return "review";
  return unitCost != null ? "priced" : "unpriced";
}

export function allocateDirectCosts(
  quantity: number,
  unitCost: number | null,
  breakdown: UnitCostBreakdown | null,
): { laborCost: number; materialCost: number; equipmentCost: number } {
  const qty = Number.isFinite(quantity) ? quantity : 0;
  if (breakdown) {
    return {
      laborCost: breakdown.labor * qty,
      materialCost: breakdown.material * qty,
      equipmentCost: breakdown.equipment * qty,
    };
  }
  return {
    laborCost: 0,
    materialCost: (unitCost ?? 0) * qty,
    equipmentCost: 0,
  };
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeNumber(value: unknown): string {
  if (value == null || value === "") return "";
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

export function takeoffSyncFingerprint(item: TakeoffSyncIdentity): string {
  return [
    normalizeText(item.label),
    normalizeText(item.csi_code),
    normalizeNumber(item.quantity),
    normalizeText(item.unit),
    normalizeText(item.meta?.drawing_ref),
    normalizeText(item.meta?.location_tag),
  ].join("|");
}
