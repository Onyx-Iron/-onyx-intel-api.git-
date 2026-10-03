import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seedLineCosts } from "./seed-pricing.ts";

describe("seedLineCosts", () => {
  it("books a flat catalog price entirely as material", () => {
    const costs = seedLineCosts(10, null, { unit_cost: 48, source: "national_price" });
    assert.equal(costs.pricing_status, "priced");
    assert.equal(costs.labor_cost, 0);
    assert.equal(costs.material_cost, 480);
    assert.equal(costs.equipment_cost, 0);
  });

  it("uses a resolver labor, material, and equipment split when one exists", () => {
    const costs = seedLineCosts(2, 999, {
      unit_cost: 50,
      source: "tenant_override",
      labor_cost: 22,
      material_cost: 24,
      equipment_cost: 2,
    });
    assert.equal(costs.labor_cost, 44);
    assert.equal(costs.material_cost, 48);
    assert.equal(costs.equipment_cost, 4);
    assert.equal(costs.unit_cost, 50);
  });

  it("books a takeoff unit rate as material when the catalog has no price", () => {
    const costs = seedLineCosts(4, 12.5, { unit_cost: 0, source: "none" });
    assert.equal(costs.material_cost, 50);
    assert.equal(costs.labor_cost, 0);
    assert.equal(costs.pricing_status, "priced");
  });

  it("leaves a line unpriced when neither source has a unit cost", () => {
    const costs = seedLineCosts(8, 0, null);
    assert.equal(costs.pricing_status, "unpriced");
    assert.equal(costs.labor_cost, 0);
    assert.equal(costs.material_cost, 0);
    assert.equal(costs.equipment_cost, 0);
    assert.equal(costs.unit_cost, null);
  });
});
