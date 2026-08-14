import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasPricingBasisChanged, resolveEstimateItemId, validateEstimateRowVersion, validateEstimateWriteNumbers } from "./write-policy";

describe("estimate write ownership policy", () => {
  it("accepts an id only when it already belongs to the target version", () => {
    const existing = new Set(["item-in-version"]);
    assert.deepEqual(resolveEstimateItemId("item-in-version", existing, () => "new-id"), {
      valid: true, id: "item-in-version", existing: true,
    });
    assert.deepEqual(resolveEstimateItemId("known-item-from-another-version", existing, () => "new-id"), {
      valid: false, reason: "item_not_in_version",
    });
  });

  it("always assigns new item ids on the server", () => {
    assert.deepEqual(resolveEstimateItemId(undefined, new Set(), () => "server-id"), {
      valid: true, id: "server-id", existing: false,
    });
  });

  it("rejects stale item revisions instead of silently overwriting", () => {
    assert.equal(validateEstimateRowVersion(4, 4), true);
    assert.equal(validateEstimateRowVersion(3, 4), false);
    assert.equal(validateEstimateRowVersion(undefined, 4), false);
  });

  it("rejects negative, non-finite, or invalid percentage inputs", () => {
    assert.equal(validateEstimateWriteNumbers({ quantity: 1, labor_cost: 10 }).valid, true);
    assert.deepEqual(validateEstimateWriteNumbers({ quantity: -1 }), { valid: false, field: "quantity" });
    assert.deepEqual(validateEstimateWriteNumbers({ material_cost: -0.01 }), { valid: false, field: "material_cost" });
    assert.deepEqual(validateEstimateWriteNumbers({ profit_pct: Number.NaN }), { valid: false, field: "profit_pct" });
  });

  it("invalidates price evidence when quantity, unit, cost code, or a cost component changes", () => {
    const existing = {
      cost_code: "03-30-00", quantity: 100, uom: "SF", labor_cost: 10,
      material_cost: 20, equipment_cost: 0, trucking_cost: 0,
      subcontract_cost: 0, disposal_cost: 0, testing_cost: 0,
      other_direct_cost: 0, indirect_cost: 0,
    };
    assert.equal(hasPricingBasisChanged(existing, { ...existing, description: "Renamed only" }), false);
    assert.equal(hasPricingBasisChanged(existing, { ...existing, quantity: 101 }), true);
    assert.equal(hasPricingBasisChanged(existing, { ...existing, material_cost: 21 }), true);
    assert.equal(hasPricingBasisChanged(existing, { ...existing, uom: "CY" }), true);
    assert.equal(hasPricingBasisChanged(existing, { ...existing, cost_code: "03-31-00" }), true);
  });
});
