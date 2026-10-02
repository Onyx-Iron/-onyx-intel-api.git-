import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { snapshotBudget } from "./budget.ts";

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
