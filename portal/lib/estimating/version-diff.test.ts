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
    assert.equal(diff.changed[0].quantityDelta, 2);
    assert.equal(diff.changed[0].totalDelta, 96);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].csi_code, "23-31-13");
    assert.equal(diff.removed.length, 0);
  });
});
