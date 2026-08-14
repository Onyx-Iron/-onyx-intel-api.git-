import { applyVersionPercentages, calculateItem } from "./calculations";

export interface ApprovedPriceObservation {
  id: string;
  tenant_id: string;
  project_id: string | null;
  cost_code: string | null;
  description: string;
  source_kind: string;
  source_ref: string | null;
  effective_date: string;
  expires_at: string | null;
  unit: string;
  currency: string;
  labor_cost: number;
  material_cost: number;
  equipment_cost: number;
  subcontract_cost: number;
  other_cost: number;
  tax_cost: number;
  freight_cost: number;
  waste_cost: number;
  escalation_cost: number;
  confidence: number;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
}

export type ApprovedPriceApplication =
  | { valid: false; reason: "unapproved" | "ai_provisional" | "future" | "expired" | "project_mismatch" | "unit_mismatch" | "cost_code_mismatch" | "invalid_quantity" }
  | { valid: true; patch: Record<string, unknown> };

export function resolveApprovedPriceApplication(input: {
  projectId: string;
  costCode: string | null;
  quantity: number;
  unit: string;
  percentages: { contingencyPct?: number | null; overheadPct?: number | null; profitPct?: number | null };
  asOfDate: string;
}, observation: ApprovedPriceObservation): ApprovedPriceApplication {
  if (observation.approval_status !== "approved" || !observation.approved_by || !observation.approved_at) return { valid: false, reason: "unapproved" };
  if (observation.source_kind === "ai_estimate") return { valid: false, reason: "ai_provisional" };
  if (observation.effective_date > input.asOfDate) return { valid: false, reason: "future" };
  if (observation.expires_at && observation.expires_at < input.asOfDate) return { valid: false, reason: "expired" };
  if (observation.project_id && observation.project_id !== input.projectId) return { valid: false, reason: "project_mismatch" };
  if (observation.unit.trim().toUpperCase() !== input.unit.trim().toUpperCase()) return { valid: false, reason: "unit_mismatch" };
  if (observation.cost_code && input.costCode && observation.cost_code !== input.costCode) return { valid: false, reason: "cost_code_mismatch" };
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return { valid: false, reason: "invalid_quantity" };

  const quantity = input.quantity;
  const laborCost = observation.labor_cost * quantity;
  const materialCost = observation.material_cost * quantity;
  const equipmentCost = observation.equipment_cost * quantity;
  const subcontractCost = observation.subcontract_cost * quantity;
  const otherDirectCost = (observation.other_cost + observation.tax_cost + observation.freight_cost + observation.waste_cost + observation.escalation_cost) * quantity;
  const direct = laborCost + materialCost + equipmentCost + subcontractCost + otherDirectCost;
  const derived = applyVersionPercentages(direct, 0, input.percentages);
  const calculation = calculateItem({
    quantity, laborCost, materialCost, equipmentCost, subcontractCost, otherDirectCost,
    contingency: derived.contingency, overhead: derived.overhead, profit: derived.profit,
  });
  return {
    valid: true,
    patch: {
      labor_cost: laborCost,
      material_cost: materialCost,
      equipment_cost: equipmentCost,
      subcontract_cost: subcontractCost,
      other_direct_cost: otherDirectCost,
      total_direct_cost: calculation.totalDirectCost,
      contingency: derived.contingency,
      overhead: derived.overhead,
      profit: derived.profit,
      total_price: calculation.totalPrice,
      unit_price: calculation.unitPrice,
      pricing_status: "priced",
      price_observation_id: observation.id,
      price_source_snapshot: observation,
      pricing_effective_date: observation.effective_date,
      pricing_confidence: observation.confidence,
    },
  };
}
