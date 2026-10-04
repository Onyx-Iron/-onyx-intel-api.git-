import type { EstimateQualityReport } from "@/lib/estimating/estimate-qc";

// Field lists for server-side financial redaction (frontend-backend
// reconciliation, item 4). Kept separate from permissions.ts so each API
// route only needs to name which of its own columns are financial —
// `redactFinancialFields` (permissions.ts) does the actual nulling.

import { canReadFinancial, redactFinancialFields, type Role } from "@/lib/project-controls/permissions";

/** estimate_items columns a restricted role must never receive. */
export const ESTIMATE_FINANCIAL_FIELDS = [
  "unit_cost", "labor_cost", "material_cost", "equipment_cost", "trucking_cost",
  "subcontract_cost", "disposal_cost", "testing_cost", "other_direct_cost",
  "total_direct_cost", "indirect_cost", "contingency", "overhead", "profit",
  "total_price", "unit_price",
] as const;

/** change_order_items columns a restricted role must never receive. */
export const CHANGE_ORDER_FINANCIAL_FIELDS = [
  "amount", "labor_cost", "material_cost", "equipment_cost", "subcontract_cost", "markup",
] as const;

/** invoices columns a restricted role must never receive. */
export const INVOICE_FINANCIAL_FIELDS = [
  "amount", "retainage",
] as const;

/** staff_members pay. Names and roles stay visible. */
export const STAFF_FINANCIAL_FIELDS = ["hourly_rate"] as const;

/** vendor_bids price. Vendor name and lead time stay visible. */
export const VENDOR_BID_FINANCIAL_FIELDS = ["unit_price"] as const;

/** purchase_orders price. PO number and status stay visible. */
export const PURCHASE_ORDER_FINANCIAL_FIELDS = ["total_amount"] as const;

/** bid_opportunities dollar value. Stage and due date stay visible. */
export const OPPORTUNITY_FINANCIAL_FIELDS = ["bid_value"] as const;

/** cost_overrides dollars. The CSI code itself stays visible. */
export const COST_OVERRIDE_FINANCIAL_FIELDS = [
  "unit_cost", "labor_cost", "material_cost", "equipment_cost",
] as const;

/** cost_actuals dollars and the variance derived from them. */
export const COST_ACTUAL_FINANCIAL_FIELDS = [
  "actual_unit_cost", "estimated_unit_cost", "variance_pct",
] as const;

/** resolveCost / cost-catalog v2 dollars. */
export const RESOLVED_COST_FINANCIAL_FIELDS = [
  "unit_cost", "labor_cost", "material_cost", "equipment_cost",
] as const;

/** estimate_versions columns that reveal markup strategy. */
export const VERSION_MARKUP_FIELDS = [
  "contingency_pct", "overhead_pct", "profit_pct",
] as const;

/** projects columns a restricted role must never receive. */
export const PROJECT_FINANCIAL_FIELDS = ["budget"] as const;

/** Keys that show up in audit old/new snapshots and activity-adjacent JSON. */
export const AUDIT_MONEY_KEYS = [
  ...ESTIMATE_FINANCIAL_FIELDS,
  ...CHANGE_ORDER_FINANCIAL_FIELDS,
  ...INVOICE_FINANCIAL_FIELDS,
  ...PROJECT_FINANCIAL_FIELDS,
  "unit_price",
  "total_amount",
  "estimated_unit_cost",
  "actual_unit_cost",
  "hourly_rate",
  "bid_value",
] as const;

type MoneyRow = Record<string, unknown>;

export function redactStaffItems<T extends MoneyRow>(rows: T[], role: Role): T[] {
  return redactFinancialFields(rows, role, STAFF_FINANCIAL_FIELDS);
}

export function redactOpportunityRows<T extends MoneyRow>(rows: T[], role: Role): T[] {
  return redactFinancialFields(rows, role, OPPORTUNITY_FINANCIAL_FIELDS);
}

export function redactCostOverrideRows<T extends MoneyRow>(rows: T[], role: Role): T[] {
  return redactFinancialFields(rows, role, COST_OVERRIDE_FINANCIAL_FIELDS);
}

export function redactCostActualRows<T extends MoneyRow>(rows: T[], role: Role): T[] {
  return redactFinancialFields(rows, role, COST_ACTUAL_FINANCIAL_FIELDS);
}

export function redactResolvedCosts<T extends MoneyRow>(rows: T[], role: Role): T[] {
  return redactFinancialFields(rows, role, RESOLVED_COST_FINANCIAL_FIELDS);
}

export interface ProcurementBatch<TItem extends MoneyRow & { bids?: MoneyRow[] }> {
  items: TItem[];
}

/** Hide vendor unit prices and PO totals. Quantities, vendors, and statuses stay. */
export function redactProcurementRead<TItem extends MoneyRow & { bids?: MoneyRow[] }, TBatch extends ProcurementBatch<TItem>>(
  batches: TBatch[],
  purchaseOrders: MoneyRow[],
  role: Role,
): { batches: TBatch[]; purchaseOrders: MoneyRow[] } {
  if (canReadFinancial(role)) return { batches, purchaseOrders };
  return {
    batches: batches.map((batch) => ({
      ...batch,
      items: batch.items.map((item) => ({
        ...item,
        bids: redactFinancialFields(item.bids ?? [], role, VENDOR_BID_FINANCIAL_FIELDS),
      })),
    })),
    purchaseOrders: redactFinancialFields(purchaseOrders, role, PURCHASE_ORDER_FINANCIAL_FIELDS),
  };
}

export function redactAuditSnapshot(value: unknown, canRead: boolean): unknown {
  if (canRead || value == null || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of AUDIT_MONEY_KEYS) {
    if (key in copy) copy[key] = null;
  }
  return copy;
}

export interface OverviewMoney {
  estimate_value: number | null;
  pending_change_order_value: number | null;
  approved_change_order_value: number | null;
}

/** Project summary dollars. Restricted roles get nulls, not zeros, so the UI does not show a fake $0 bid. */
export function overviewMoneyForReader(
  canRead: boolean,
  money: { estimate_value: number; pending_change_order_value: number; approved_change_order_value: number },
): OverviewMoney {
  if (canRead) return money;
  return {
    estimate_value: null,
    pending_change_order_value: null,
    approved_change_order_value: null,
  };
}

export function redactReportSummary<T extends { estimate_value?: number | null }>(
  summary: T | null | undefined,
  canRead: boolean,
): T | null | undefined {
  if (summary == null || canRead) return summary;
  return { ...summary, estimate_value: null };
}

/** Drops sell-price rollups from estimate QC. Counts and blockers stay. */
export function redactEstimateQuality(quality: EstimateQualityReport): Omit<EstimateQualityReport, "totals" | "audit_items"> & {
  totals: null;
  audit_items: Array<Omit<EstimateQualityReport["audit_items"][number], "total">>;
} {
  return {
    counts: quality.counts,
    blockers: quality.blockers,
    risk_score: quality.risk_score,
    ready_for_proposal: quality.ready_for_proposal,
    totals: null,
    audit_items: quality.audit_items.map((item) => ({
      id: item.id,
      description: item.description,
      reasons: item.reasons,
    })),
  };
}
