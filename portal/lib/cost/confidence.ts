/**
 * Multi-source cost confidence scoring for the catalog resolver.
 * Sources contribute weight × recency decay; variance lowers confidence.
 */

export type ConfidenceBand = "high" | "medium" | "low";

export interface CostObservation {
  unitCost: number;
  observedAt: string | Date | null;
  source: string;
}

export function scoreCostConfidence(observations: CostObservation[], now = Date.now()): {
  confidence: ConfidenceBand;
  score: number;
  sourceCount: number;
} {
  if (observations.length === 0) {
    return { confidence: "low", score: 0, sourceCount: 0 };
  }

  let weightSum = 0;
  let costWeightSum = 0;
  for (const o of observations) {
    const ageMs = o.observedAt ? Math.max(0, now - new Date(o.observedAt).getTime()) : 365 * 864e5;
    const ageDays = ageMs / 864e5;
    const recency = ageDays <= 90 ? 1 : ageDays <= 365 ? 0.6 : 0.25;
    const sourceBoost = o.source === "tenant_actual" ? 1.2 : o.source.startsWith("dot") ? 1.1 : 1;
    const w = recency * sourceBoost;
    weightSum += w;
    costWeightSum += o.unitCost * w;
  }

  const mean = costWeightSum / weightSum;
  let variance = 0;
  for (const o of observations) {
    variance += (o.unitCost - mean) ** 2;
  }
  variance /= observations.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;

  const score = Math.min(1, observations.length / 3) * 0.5
    + Math.min(1, weightSum / observations.length) * 0.35
    + (1 - Math.min(1, cv)) * 0.15;

  const confidence: ConfidenceBand =
    score >= 0.75 && observations.length >= 3 ? "high"
      : score >= 0.4 ? "medium"
        : "low";

  return { confidence, score: Math.round(score * 100) / 100, sourceCount: observations.length };
}
