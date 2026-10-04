export const UNASSIGNED_COST_CODE = "Unassigned";

export interface BudgetEstimateItem {
  cost_code: string | null;
  total_price: number | null;
}

export interface BudgetChangeItem {
  cost_code: string | null;
  amount: number | null;
  status: string | null;
}

export interface BudgetPurchaseOrder {
  cost_code: string | null;
  total_amount: number | null;
}

export interface BudgetInvoice {
  cost_code: string | null;
  amount: number | null;
  direction: string | null;
}

export interface CostCodeBudgetInput {
  estimateItems: BudgetEstimateItem[];
  changeItems: BudgetChangeItem[];
  purchaseOrders: BudgetPurchaseOrder[];
  invoices: BudgetInvoice[];
}

export interface CostCodeBudgetRow {
  cost_code: string;
  original: number;
  approved_changes: number;
  committed: number;
  actual: number;
}

function money(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function codeKey(code: string | null | undefined): string {
  const trimmed = code?.trim();
  return trimmed ? trimmed : UNASSIGNED_COST_CODE;
}

/**
 * One read-only row per cost code. Original estimate, approved changes,
 * purchase orders, and payable invoices stay on the code they already carry.
 * A row with no code lands on Unassigned.
 */
export function costCodeBudget(input: CostCodeBudgetInput): CostCodeBudgetRow[] {
  const rows = new Map<string, CostCodeBudgetRow>();
  const bucket = (code: string | null | undefined): CostCodeBudgetRow => {
    const key = codeKey(code);
    const existing = rows.get(key);
    if (existing) return existing;
    const created: CostCodeBudgetRow = {
      cost_code: key,
      original: 0,
      approved_changes: 0,
      committed: 0,
      actual: 0,
    };
    rows.set(key, created);
    return created;
  };

  for (const item of input.estimateItems) {
    bucket(item.cost_code).original += money(item.total_price);
  }
  for (const item of input.changeItems) {
    if ((item.status ?? "").toLowerCase() !== "approved") continue;
    bucket(item.cost_code).approved_changes += money(item.amount);
  }
  for (const order of input.purchaseOrders) {
    bucket(order.cost_code).committed += money(order.total_amount);
  }
  for (const invoice of input.invoices) {
    if ((invoice.direction ?? "").toLowerCase() !== "payable") continue;
    bucket(invoice.cost_code).actual += money(invoice.amount);
  }

  return [...rows.values()].sort((a, b) => {
    if (a.cost_code === UNASSIGNED_COST_CODE) return 1;
    if (b.cost_code === UNASSIGNED_COST_CODE) return -1;
    return a.cost_code.localeCompare(b.cost_code);
  });
}
