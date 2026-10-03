import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canEditVertex, recomputeShapeQuantity } from "./shape-edit.ts";

describe("shape-edit", () => {
  it("recomputes length and area from page-space points", () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    assert.equal(recomputeShapeQuantity("length", line, 2), 20);

    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    assert.equal(recomputeShapeQuantity("area", square, 2), 400);
  });

  it("counts points without calibration", () => {
    assert.equal(recomputeShapeQuantity("count", [{ x: 1, y: 1 }, { x: 2, y: 2 }], 99), 2);
  });

  it("gates vertex editability by tool geometry", () => {
    assert.equal(canEditVertex("length", 2, 0), true);
    assert.equal(canEditVertex("length", 1, 0), false);
    assert.equal(canEditVertex("area", 3, 2), true);
    assert.equal(canEditVertex("area", 2, 0), false);
    assert.equal(canEditVertex("count", 1, 0), true);
  });
});
