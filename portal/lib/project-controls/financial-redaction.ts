// Field lists for server-side financial redaction (frontend-backend
// reconciliation, item 4). Kept separate from permissions.ts so each API
// route only needs to name which of its own columns are financial —
// `redactFinancialFields` (permissions.ts) does the actual nulling.

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
