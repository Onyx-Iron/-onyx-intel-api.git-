import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { costCodeBudget, UNASSIGNED_COST_CODE } from "./cost-code-budget";

describe("costCodeBudget", () => {
  it("keeps uncoded purchase orders and invoices on Unassigned", () => {
    const rows = costCodeBudget({
      estimateItems: [
        { cost_code: "03-30-00", total_price: 1000 },
        { cost_code: null, total_price: 25 },
      ],
      changeItems: [
        { cost_code: "03-30-00", amount: 100, status: "approved" },
        { cost_code: "03-30-00", amount: 999, status: "pending" },
        { cost_code: null, amount: 40, status: "approved" },
      ],
      purchaseOrders: [
        { cost_code: "03-30-00", total_amount: 400 },
        { cost_code: null, total_amount: 75 },
      ],
      invoices: [
        { cost_code: "03-30-00", amount: 200, direction: "payable" },
        { cost_code: null, amount: 15, direction: "payable" },
        { cost_code: null, amount: 500, direction: "receivable" },
      ],
    });

    const concrete = rows.find((row) => row.cost_code === "03-30-00");
    const unassigned = rows.find((row) => row.cost_code === UNASSIGNED_COST_CODE);
    assert.ok(concrete);
    assert.equal(concrete.original, 1000);
    assert.equal(concrete.approved_changes, 100);
    assert.equal(concrete.committed, 400);
    assert.equal(concrete.actual, 200);
    assert.ok(unassigned);
    assert.equal(unassigned.original, 25);
    assert.equal(unassigned.approved_changes, 40);
    assert.equal(unassigned.committed, 75);
    assert.equal(unassigned.actual, 15);
  });
});