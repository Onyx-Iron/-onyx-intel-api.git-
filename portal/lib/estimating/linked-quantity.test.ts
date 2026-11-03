import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { directCostsForKeptQuantity, quantityForLinkedLine } from "./linked-quantity.ts";

describe("linked estimate quantity", () => {
  it("keeps the measurement until the line is unlinked", () => {
    assert.equal(quantityForLinkedLine(18, 99, "takeoff-1", false), 18);
    assert.equal(quantityForLinkedLine(18, 99, "takeoff-1", true), 99);
    assert.equal(quantityForLinkedLine(18, 99, null, false), 99);
  });

  it("keeps the unit rate when a linked quantity edit is discarded", () => {
    const costs = directCostsForKeptQuantity(
      { labor_cost: 200, material_cost: 40 },
      { labor_cost: 100, material_cost: 20 },
      20,
      10,
    );
    assert.equal(costs.labor_cost, 100);
    assert.equal(costs.material_cost, 20);
  });

  it("applies a new unit rate at the kept quantity", () => {
    const costs = directCostsForKeptQuantity(
      { labor_cost: 300 },
      { labor_cost: 100 },
      20,
      10,
    );
    assert.equal(costs.labor_cost, 150);
  });

  it("does not zero the price when a linked quantity is cleared", () => {
    const costs = directCostsForKeptQuantity(
      { labor_cost: 0, material_cost: 0 },
      { labor_cost: "100.00", material_cost: 20 },
      0,
      10,
    );
    assert.equal(costs.labor_cost, 100);
    assert.equal(costs.material_cost, 20);
  });

  it("stores an unlinked quantity edit as submitted", () => {
    const costs = directCostsForKeptQuantity(
      { labor_cost: 200 },
      { labor_cost: 100 },
      20,
      20,
    );
    assert.equal(costs.labor_cost, 200);
  });
});
