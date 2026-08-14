export interface CapabilityBoundary { tradeFamily: string; sourceType: string; quantityType: string }
export interface CapabilityMetrics {
  fixtures: number;
  recall?: number;
  precision?: number;
  unitAccuracy?: number;
  scopeCompleteness?: number;
  maxQuantityError?: number;
  boundary?: CapabilityBoundary;
}
export interface CapabilityCertification {
  status: "certified" | "provisional" | "blocked";
  boundary?: CapabilityBoundary;
  reasons: string[];
}

export function evaluateCapability(metrics: CapabilityMetrics): CapabilityCertification {
  if (metrics.fixtures <= 0) return { status: "blocked", boundary: metrics.boundary, reasons: ["no_reviewed_fixtures"] };
  const missing = [metrics.recall, metrics.precision, metrics.unitAccuracy, metrics.scopeCompleteness, metrics.maxQuantityError].some((value) => value === undefined);
  if (missing) return { status: "blocked", boundary: metrics.boundary, reasons: ["incomplete_metrics"] };
  const reasons: string[] = [];
  if (metrics.recall! < 0.95) reasons.push("recall_below_threshold");
  if (metrics.precision! < 0.98) reasons.push("precision_below_threshold");
  if (metrics.unitAccuracy! < 1) reasons.push("unit_accuracy_below_threshold");
  if (metrics.scopeCompleteness! < 0.95) reasons.push("scope_completeness_below_threshold");
  if (metrics.maxQuantityError! > 0.02) reasons.push("quantity_error_above_threshold");
  return { status: reasons.length === 0 ? "certified" : "provisional", boundary: metrics.boundary, reasons };
}

export function canClaimCertified(boundary: CapabilityBoundary, certification: Pick<CapabilityCertification, "status" | "boundary">): boolean {
  return certification.status === "certified" && Boolean(certification.boundary)
    && boundary.tradeFamily === certification.boundary!.tradeFamily
    && boundary.sourceType === certification.boundary!.sourceType
    && boundary.quantityType === certification.boundary!.quantityType;
}
