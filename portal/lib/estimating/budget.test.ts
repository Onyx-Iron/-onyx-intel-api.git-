import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchBudgetLineCarryForward, revisedBudgetAfterCarry, snapshotBudget } from "./budget.ts";

describe("approved estimate budget snapshot", () => {
  it("copies the supplied lines and their prices", () => {
    const snapshot = snapshotBudget([
      {
        id: "item-1",
        source_takeoff_id: "takeoff-1",
        csi_code: "22-11-16",
        description: "Copper pipe",
        quantity: 10,
        uom: "LF",
        labor_cost: 220,
        material_cost: 240,
        equipment_cost: 20,
        total_price: 480,
        sort_order: 1,
      },
    ]);
    assert.equal(snapshot.lineCount, 1);
    assert.equal(snapshot.totalPrice, 480);
    assert.equal(snapshot.lines[0].labor_cost, 220);
    assert.equal(snapshot.lines[0].material_cost, 240);
    assert.equal(snapshot.lines[0].source_estimate_item_id, "item-1");
  });
});

describe("budget republish carry-forward", () => {
  it("keeps approved changes and the line id for the same takeoff", () => {
    const carries = matchBudgetLineCarryForward(
      [{
        id: "old-pipe",
        source_takeoff_id: "takeoff-1",
        csi_code: "22-11-16",
        description: "Copper pipe",
        approved_change_amount: "1500.50",
        forecast_override: "200",
      }],
      [{
        id: "new-pipe",
        source_takeoff_id: "takeoff-1",
        csi_code: "22-11-16",
        description: "Copper pipe revised",
        original_amount: 480,
        approved_change_amount: 0,
      }],
    );
    assert.deepEqual(carries, [{
      fromId: "old-pipe",
      toId: "new-pipe",
      approvedChange: 1500.5,
      forecastOverride: 200,
    }]);
    assert.equal(revisedBudgetAfterCarry([
      { id: "new-pipe", original_amount: 480, approved_change_amount: 0 },
    ], carries), 1980.5);
  });

  it("matches a manual line by cost code and description when the takeoff id is absent", () => {
    const carries = matchBudgetLineCarryForward(
      [{ id: "old-fee", csi_code: "01-31-13", description: "Permit fee", approved_change_amount: 75 }],
      [{ id: "new-fee", csi_code: "01-31-13", description: "  Permit   fee ", original_amount: "25.00" }],
    );
    assert.equal(carries.length, 1);
    assert.equal(carries[0].fromId, "old-fee");
    assert.equal(carries[0].toId, "new-fee");
    assert.equal(carries[0].approvedChange, 75);
    assert.equal(revisedBudgetAfterCarry([
      { id: "new-fee", original_amount: "25.00" },
    ], carries), 100);
  });

  it("does not guess when two lines share a takeoff id or description", () => {
    const carries = matchBudgetLineCarryForward(
      [
        { id: "old-a", source_takeoff_id: "same", description: "Duplicate", csi_code: "03-30-00", approved_change_amount: 10 },
        { id: "old-b", source_takeoff_id: "same", description: "Duplicate", csi_code: "03-30-00", approved_change_amount: 20 },
      ],
      [
        { id: "new-a", source_takeoff_id: "same", description: "Duplicate", csi_code: "03-30-00" },
        { id: "new-b", source_takeoff_id: "same", description: "Duplicate", csi_code: "03-30-00" },
      ],
    );
    assert.deepEqual(carries, []);
  });
});
