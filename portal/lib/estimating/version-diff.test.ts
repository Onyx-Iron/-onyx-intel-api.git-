import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffEstimateVersions } from "./version-diff.ts";

describe("estimate version diff", () => {
  it("matches takeoff identity first, then csi and description", () => {
    const diff = diffEstimateVersions(
      [
        { source_takeoff_id: "t-1", csi_code: "22-11-16", description: "Copper", quantity: 10, unit_cost: 48, total_price: 480 },
        { csi_code: "26-24-16", description: "Panelboard", quantity: 2, unit_cost: 1850, total_price: 3700 },
      ],
      [
        { source_takeoff_id: "t-1", csi_code: "22-11-16", description: "Copper pipe", quantity: 12, unit_cost: 48, total_price: 576 },
        { csi_code: "26-24-16", description: " panelboard ", quantity: 2, unit_cost: 1850, total_price: 3700 },
        { csi_code: "23-31-13", description: "Duct", quantity: 80, unit_cost: 12.5, total_price: 1000 },
      ],
    );

    assert.equal(diff.changed.length, 1);
    assert.deepEqual(diff.changed[0].changes, ["quantity", "total_price"]);
    assert.equal(diff.changed[0].quantityDelta, 2);
    assert.equal(diff.changed[0].totalDelta, 96);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].csi_code, "23-31-13");
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.unchangedCount, 1);
  });

  it("pairs duplicate CSI+description lines in sheet order", () => {
    const diff = diffEstimateVersions(
      [
        { csi_code: "22-11-16", description: "Elbow", quantity: 2, unit_cost: 10, total_price: 20 },
        { csi_code: "22-11-16", description: "Elbow", quantity: 4, unit_cost: 10, total_price: 40 },
      ],
      [
        { csi_code: "22-11-16", description: "Elbow", quantity: 2, unit_cost: 10, total_price: 20 },
        { csi_code: "22-11-16", description: "Elbow", quantity: 5, unit_cost: 10, total_price: 50 },
      ],
    );
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.changed.length, 1);
    assert.equal(diff.changed[0].quantityDelta, 1);
    assert.equal(diff.unchangedCount, 1);
  });

  it("reports a quantity-source change", () => {
    const diff = diffEstimateVersions(
      [{ csi_code: "03-30-00", description: "Slab", quantity: 10, unit_cost: 12, total_price: 120, drawing_ref: "A1", quantity_basis: "manual" }],
      [{ csi_code: "03-30-00", description: "Slab", quantity: 10, unit_cost: 12, total_price: 120, drawing_ref: "A2", quantity_basis: "manual" }],
    );
    assert.deepEqual(diff.changed[0].changes, ["source"]);
  });

  it("ignores sub-cent money drift", () => {
    const diff = diffEstimateVersions(
      [{ csi_code: "03-30-00", description: "Slab", quantity: 1, unit_cost: 100, total_price: 100 }],
      [{ csi_code: "03-30-00", description: "Slab", quantity: 1, unit_cost: 100.001, total_price: 100.004 }],
    );
    assert.equal(diff.changed.length, 0);
    assert.equal(diff.unchangedCount, 1);
  });
});
