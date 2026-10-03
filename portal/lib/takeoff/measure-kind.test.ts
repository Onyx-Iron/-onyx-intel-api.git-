import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quantityForMeasurement } from "./canvas/quantity.ts";
import { displayTakeoffTool, measurementUnit, storedTakeoffType } from "./measure-kind.ts";

describe("measure kind", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("stores perimeter as length and prices it as a closed length", () => {
    assert.equal(storedTakeoffType("perimeter"), "length");
    assert.equal(displayTakeoffTool("length", "perimeter"), "perimeter");
    assert.equal(measurementUnit("perimeter"), "LF");
    const closed = quantityForMeasurement("length", square, 1, "perimeter");
    const open = quantityForMeasurement("length", square, 1);
    assert.equal(closed, 40);
    assert.equal(open, 30);
    assert.equal(quantityForMeasurement("area", square, 2), 400);
    assert.equal(quantityForMeasurement("count", square, 1), 4);
  });
});
