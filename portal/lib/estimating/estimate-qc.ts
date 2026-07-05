export type PricingStatus = "manual" | "priced" | "unpriced" | "review";

export interface EstimateQcItem {
  id?: string | null;
  description?: string | null;
  csi_code?: string | null;
  trade?: string | null;
  item_type?: string | null;
  quantity?: number | null;
  uom?: string | null;
  unit_cost?: number | null;
  source_takeoff_id?: string | null;
  source_fingerprint?: string | null;
  quantity_basis?: string | null;
  drawing_ref?: string | null;
  location_tag?: string | null;
  pricing_status?: string | null;
}

export interface EstimateAuditItem {
  id: string | null;
  description: string;
  total: number | null;
  reasons: string[];
}

export interface EstimateQualityReport {
  totals: {
    grand_total: number;
    by_type: Record<string, number>;
    by_csi_division: Record<string, number>;
    by_trade: Record<string, number>;
  };
  counts: {
    total_items: number;
    source_backed: number;
    manual_items: number;
    priced: number;
    unpriced: number;
    review: number;
    missing_evidence: number;
    missing_quantity: number;
    missing_unit_cost: number;
  };
  blockers: string[];
  audit_items: EstimateAuditItem[];
  risk_score: number;
  ready_for_proposal: boolean;
}

export function buildEstimateQualityReport(items: EstimateQcItem[]): EstimateQualityReport {
  const totals = {
    grand_total: 0,
    by_type: {} as Record<string, number>,
    by_csi_division: {} as Record<string, number>,
    by_trade: {} as Record<string, number>,
  };
  const counts = {
    total_items: items.length,
    source_backed: 0,
    manual_items: 0,
    priced: 0,
    unpriced: 0,
    review: 0,
    missing_evidence: 0,
    missing_quantity: 0,
    missing_unit_cost: 0,
  };
  const auditItems: EstimateAuditItem[] = [];

  for (const item of items) {
    const total = lineTotal(item);
    if (total != null) {
      totals.grand_total += total;
      increment(totals.by_type, normalizeBucket(item.item_type, "Uncategorized"), total);
      increment(totals.by_csi_division, csiDivision(item.csi_code), total);
      increment(totals.by_trade, normalizeBucket(item.trade, "Unassigned trade"), total);
    }

    const status = normalizePricingStatus(item.pricing_status, item.unit_cost);
    if (status === "priced") counts.priced++;
    if (status === "unpriced") counts.unpriced++;
    if (status === "review") counts.review++;

    const sourceBacked = Boolean(clean(item.source_takeoff_id) || clean(item.source_fingerprint));
    if (sourceBacked) counts.source_backed++;
    else counts.manual_items++;

    const reasons: string[] = [];
    if (status === "unpriced") reasons.push("Needs unit pricing");
    if (status === "review") reasons.push("Estimator review required");
    if (!isFinitePositive(item.quantity)) reasons.push("Missing or zero quantity");
    if (!isFinitePositive(item.unit_cost)) reasons.push("Missing or zero unit cost");
    if (sourceBacked && !hasEvidence(item)) reasons.push("Source-backed row missing drawing, location, or quantity basis");

    if (!isFinitePositive(item.quantity)) counts.missing_quantity++;
    if (!isFinitePositive(item.unit_cost)) counts.missing_unit_cost++;
    if (sourceBacked && !hasEvidence(item)) counts.missing_evidence++;

    if (reasons.length > 0) {
      auditItems.push({
        id: clean(item.id),
        description: clean(item.description) ?? "Estimate item",
        total,
        reasons,
      });
    }
  }

  totals.grand_total = roundCurrency(totals.grand_total);
  roundRecord(totals.by_type);
  roundRecord(totals.by_csi_division);
  roundRecord(totals.by_trade);

  const blockers = buildBlockers(counts);
  const riskScore = calculateRiskScore(counts);

  return {
    totals,
    counts,
    blockers,
    audit_items: auditItems,
    risk_score: riskScore,
    ready_for_proposal: blockers.length === 0,
  };
}

function buildBlockers(counts: EstimateQualityReport["counts"]): string[] {
  const blockers: string[] = [];
  if (counts.unpriced > 0) blockers.push(`${counts.unpriced} estimate item${plural(counts.unpriced)} need unit pricing`);
  if (counts.review > 0) blockers.push(`${counts.review} estimate item${plural(counts.review)} require estimator review`);
  if (counts.missing_quantity > 0) blockers.push(`${counts.missing_quantity} estimate item${plural(counts.missing_quantity)} are missing a usable quantity`);
  if (counts.missing_unit_cost > 0) blockers.push(`${counts.missing_unit_cost} estimate item${plural(counts.missing_unit_cost)} are missing a usable unit cost`);
  if (counts.missing_evidence > 0) blockers.push(`${counts.missing_evidence} source-backed estimate item${plural(counts.missing_evidence)} are missing drawing, location, or quantity basis evidence`);
  return blockers;
}

function calculateRiskScore(counts: EstimateQualityReport["counts"]): number {
  if (counts.total_items === 0) return 100;
  const weighted =
    counts.unpriced * 30 +
    counts.review * 25 +
    counts.missing_quantity * 30 +
    counts.missing_unit_cost * 30 +
    counts.missing_evidence * 15 +
    counts.manual_items * 5;
  return Math.min(100, Math.round(weighted / counts.total_items));
}

function lineTotal(item: EstimateQcItem): number | null {
  if (!isFinitePositive(item.quantity) || !isFinitePositive(item.unit_cost)) return null;
  return roundCurrency(Number(item.quantity) * Number(item.unit_cost));
}

function normalizePricingStatus(status: string | null | undefined, unitCost: number | null | undefined): PricingStatus {
  if (status === "manual" || status === "priced" || status === "unpriced" || status === "review") return status;
  return isFinitePositive(unitCost) ? "priced" : "unpriced";
}

function hasEvidence(item: EstimateQcItem): boolean {
  return Boolean(clean(item.quantity_basis) || clean(item.drawing_ref) || clean(item.location_tag));
}

function csiDivision(value: string | null | undefined): string {
  const code = clean(value);
  if (!code) return "Unassigned CSI";
  const match = code.match(/^(\d{2})/);
  return match ? `Division ${match[1]}` : "Unassigned CSI";
}

function normalizeBucket(value: string | null | undefined, fallback: string): string {
  return clean(value) ?? fallback;
}

function increment(record: Record<string, number>, key: string, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

function roundRecord(record: Record<string, number>): void {
  for (const key of Object.keys(record)) record[key] = roundCurrency(record[key]);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isFinitePositive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
