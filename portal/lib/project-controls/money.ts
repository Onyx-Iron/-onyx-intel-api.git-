export interface ProjectMoney {
  estimate_value: number;
  change_orders_pending: number;
  change_orders_approved: number;
  pending_change_order_value: number;
  approved_change_order_value: number;
}

export interface EstimateValueRow {
  quantity: number | null;
  unit_cost: number | null;
}

export interface ChangeOrderMoneyRow {
  status: string | null;
  amount: number | null;
}

/** Same total the overview used to compute after downloading every estimate row. */
export function sumEstimateValue(rows: EstimateValueRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (row.quantity != null && row.unit_cost != null) total += row.quantity * row.unit_cost;
  }
  return total;
}

/** Pending and approved change-order counts and amounts, with a null amount counting as zero. */
export function summarizeChangeOrderMoney(rows: ChangeOrderMoneyRow[]): Omit<ProjectMoney, "estimate_value"> {
  let change_orders_pending = 0;
  let change_orders_approved = 0;
  let pending_change_order_value = 0;
  let approved_change_order_value = 0;
  for (const row of rows) {
    const amount = row.amount ?? 0;
    if (row.status === "pending") {
      change_orders_pending += 1;
      pending_change_order_value += amount;
    } else if (row.status === "approved") {
      change_orders_approved += 1;
      approved_change_order_value += amount;
    }
  }
  return {
    change_orders_pending,
    change_orders_approved,
    pending_change_order_value,
    approved_change_order_value,
  };
}

export function projectMoneyFromRows(estimates: EstimateValueRow[], changeOrders: ChangeOrderMoneyRow[]): ProjectMoney {
  return {
    estimate_value: Math.round(sumEstimateValue(estimates)),
    ...summarizeChangeOrderMoney(changeOrders),
  };
}

export function projectMoneyFromAggregate(row: {
  estimate_value?: number | string | null;
  change_orders_pending?: number | string | null;
  change_orders_approved?: number | string | null;
  pending_change_order_value?: number | string | null;
  approved_change_order_value?: number | string | null;
}): ProjectMoney {
  return {
    estimate_value: Math.round(Number(row.estimate_value ?? 0)),
    change_orders_pending: Number(row.change_orders_pending ?? 0),
    change_orders_approved: Number(row.change_orders_approved ?? 0),
    pending_change_order_value: Number(row.pending_change_order_value ?? 0),
    approved_change_order_value: Number(row.approved_change_order_value ?? 0),
  };
}
