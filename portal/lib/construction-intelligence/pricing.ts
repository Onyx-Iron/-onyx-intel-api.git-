export const PRICE_SOURCE_PRECEDENCE = [
  "project_quote",
  "company_actual",
  "historical_project",
  "licensed_dataset",
  "public_index",
  "local_market",
  "ai_estimate",
] as const;

export type PriceSourceKind = (typeof PRICE_SOURCE_PRECEDENCE)[number];

export type PriceApprovalStatus = "unreviewed" | "approved" | "rejected" | "expired";

export interface PriceObservationCandidate {
  id: string;
  sourceKind: PriceSourceKind;
  approvalStatus: PriceApprovalStatus;
  effectiveDate: string;
  expiresAt: string | null;
  projectId: string | null;
  postalCode: string | null;
  metroCode: string | null;
  stateCode: string | null;
  confidence: number;
}

export interface PriceObservationContext {
  projectId?: string;
  postalCode?: string;
  metroCode?: string;
  stateCode?: string;
  asOfDate: string;
}

export interface SelectedPriceObservation<T extends PriceObservationCandidate> {
  observation: T;
  authoritative: boolean;
  provisionalReason: "ai_estimate" | "unreviewed" | null;
}

export interface PricingInputs {
  labor: number;
  material: number;
  equipment: number;
  subcontract: number;
  other?: number;
  tax?: number;
  freight?: number;
  waste?: number;
  escalation?: number;
  contingencyRate?: number;
  overheadRate?: number;
  targetMarginRate?: number;
  minimumMarginRate?: number;
  riskRate?: number;
  competitiveLowFactor?: number;
  competitiveHighFactor?: number;
}

export interface PricingResult {
  expectedDirectCost: number;
  riskAdjustedCost: number;
  targetSellPrice: number;
  minimumAcceptablePrice: number;
  competitiveLow: number;
  competitiveHigh: number;
  expectedGrossProfit: number;
  expectedMarginRate: number;
  markupRate: number;
}

function finiteNonnegative(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : 0;
}

function boundedRate(value: number | undefined, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Number(value), 0), 0.95);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function priceFromMargin(cost: number, marginRate: number): number {
  const margin = boundedRate(marginRate);
  return margin >= 0.95 ? cost / 0.05 : cost / (1 - margin);
}

export function calculatePricing(input: PricingInputs): PricingResult {
  const base = [input.labor, input.material, input.equipment, input.subcontract, input.other, input.tax, input.freight, input.waste, input.escalation]
    .reduce<number>((sum, value) => sum + finiteNonnegative(value), 0);
  const contingency = base * boundedRate(input.contingencyRate);
  const overhead = (base + contingency) * boundedRate(input.overheadRate);
  const expectedDirectCost = base + contingency + overhead;
  const riskAdjustedCost = expectedDirectCost * (1 + boundedRate(input.riskRate));
  const minimumMarginRate = boundedRate(input.minimumMarginRate);
  const targetMarginRate = Math.max(minimumMarginRate, boundedRate(input.targetMarginRate));
  const minimumAcceptablePrice = priceFromMargin(riskAdjustedCost, minimumMarginRate);
  const targetSellPrice = Math.max(priceFromMargin(riskAdjustedCost, targetMarginRate), minimumAcceptablePrice);
  const competitiveLow = Math.max(minimumAcceptablePrice, targetSellPrice * finiteNonnegative(input.competitiveLowFactor ?? 0.96));
  const competitiveHigh = Math.max(competitiveLow, targetSellPrice * finiteNonnegative(input.competitiveHighFactor ?? 1.04));
  const expectedGrossProfit = targetSellPrice - riskAdjustedCost;

  return {
    expectedDirectCost: roundMoney(expectedDirectCost),
    riskAdjustedCost: roundMoney(riskAdjustedCost),
    targetSellPrice: roundMoney(targetSellPrice),
    minimumAcceptablePrice: roundMoney(minimumAcceptablePrice),
    competitiveLow: roundMoney(competitiveLow),
    competitiveHigh: roundMoney(competitiveHigh),
    expectedGrossProfit: roundMoney(expectedGrossProfit),
    expectedMarginRate: targetSellPrice === 0 ? 0 : expectedGrossProfit / targetSellPrice,
    markupRate: riskAdjustedCost === 0 ? 0 : expectedGrossProfit / riskAdjustedCost,
  };
}

export function comparePriceSources(a: PriceSourceKind, b: PriceSourceKind): number {
  return PRICE_SOURCE_PRECEDENCE.indexOf(a) - PRICE_SOURCE_PRECEDENCE.indexOf(b);
}

function geographyScore(observation: PriceObservationCandidate, context: PriceObservationContext): number | null {
  if (observation.postalCode) return observation.postalCode === context.postalCode ? 3 : null;
  if (observation.metroCode) return observation.metroCode === context.metroCode ? 2 : null;
  if (observation.stateCode) return observation.stateCode === context.stateCode ? 1 : null;
  return 0;
}

function isAuthoritative(observation: PriceObservationCandidate): boolean {
  return observation.approvalStatus === "approved" && observation.sourceKind !== "ai_estimate";
}

export function selectPriceObservation<T extends PriceObservationCandidate>(
  observations: T[],
  context: PriceObservationContext,
): SelectedPriceObservation<T> | null {
  const eligible = observations
    .map((observation) => ({ observation, geography: geographyScore(observation, context) }))
    .filter(({ observation, geography }) => {
      if (geography === null) return false;
      if (observation.approvalStatus === "rejected" || observation.approvalStatus === "expired") return false;
      if (observation.effectiveDate > context.asOfDate) return false;
      if (observation.expiresAt && observation.expiresAt < context.asOfDate) return false;
      if (observation.projectId && observation.projectId !== context.projectId) return false;
      return true;
    })
    .sort((a, b) => {
      const authority = Number(isAuthoritative(b.observation)) - Number(isAuthoritative(a.observation));
      if (authority !== 0) return authority;
      const precedence = comparePriceSources(a.observation.sourceKind, b.observation.sourceKind);
      if (precedence !== 0) return precedence;
      const projectSpecificity = Number(Boolean(b.observation.projectId)) - Number(Boolean(a.observation.projectId));
      if (projectSpecificity !== 0) return projectSpecificity;
      if (a.geography !== b.geography) return Number(b.geography) - Number(a.geography);
      const freshness = b.observation.effectiveDate.localeCompare(a.observation.effectiveDate);
      if (freshness !== 0) return freshness;
      return b.observation.confidence - a.observation.confidence;
    });

  const observation = eligible[0]?.observation;
  if (!observation) return null;
  const provisionalReason = observation.sourceKind === "ai_estimate"
    ? "ai_estimate"
    : observation.approvalStatus === "unreviewed"
      ? "unreviewed"
      : null;
  return { observation, authoritative: isAuthoritative(observation), provisionalReason };
}
