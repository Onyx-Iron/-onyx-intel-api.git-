import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectMoneyFromAggregate, projectMoneyFromRows } from "./money.ts";

describe("project money totals", () => {
  it("skips estimate rows missing quantity or unit cost and rounds once", () => {
    const money = projectMoneyFromRows(
      [
        { quantity: 2, unit_cost: 10.2 },
        { quantity: null, unit_cost: 99 },
        { quantity: 4, unit_cost: null },
        { quantity: 1.5, unit_cost: 3 },
      ],
      [
        { status: "pending", amount: 100 },
        { status: "pending", amount: null },
        { status: "approved", amount: 40.5 },
        { status: "draft", amount: 1000 },
      ],
    );
    assert.equal(money.estimate_value, Math.round(2 * 10.2 + 1.5 * 3));
    assert.equal(money.change_orders_pending, 2);
    assert.equal(money.pending_change_order_value, 100);
    assert.equal(money.change_orders_approved, 1);
    assert.equal(money.approved_change_order_value, 40.5);
  });

  it("reads numeric strings from the database aggregate", () => {
    const money = projectMoneyFromAggregate({
      estimate_value: "20.6",
      change_orders_pending: "2",
      change_orders_approved: "1",
      pending_change_order_value: "100.5",
      approved_change_order_value: "40",
    });
    assert.deepEqual(money, {
      estimate_value: 21,
      change_orders_pending: 2,
      change_orders_approved: 1,
      pending_change_order_value: 100.5,
      approved_change_order_value: 40,
    });
  });
});
