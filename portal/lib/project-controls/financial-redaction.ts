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
