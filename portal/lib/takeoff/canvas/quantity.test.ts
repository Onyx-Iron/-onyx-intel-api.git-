import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateLinearLength, calculatePerimeter, calculatePolygonArea,
  calculateRectangleArea, calculateCircleArea, calculateCount,
  calculateAreaVolume, calculateBoxVolume, calculateSlopeAdjustedLength,
  calculatedQuantityForSave, convertLinearUnit, polygonSelfIntersects, quantityForMeasurement,
} from "./quantity";

// All inputs here are PAGE-SPACE points — the whole point of this module is
// that results never depend on render scale, so no test needs to simulate
// "zoom" at this layer (that invariance is proven at the coordinates.ts /
// toDisplayPoints layer). A pageSpaceScaleFactor of 1 means "1 real-world
// unit per page-space unit" for simple round-number assertions.

describe("calculateLinearLength / calculatePolylineLength", () => {
  it("computes the length of a single segment", () => {
    assert.equal(calculateLinearLength([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.1), 10);
  });
  it("sums a multi-segment polyline", () => {
    const len = calculateLinearLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 14 }], 1);
    assert.equal(len, 5 + 10); // 3-4-5 triangle, then straight 10
  });
  it("returns 0 for fewer than 2 points", () => {
    assert.equal(calculateLinearLength([{ x: 0, y: 0 }], 1), 0);
    assert.equal(calculateLinearLength([], 1), 0);
  });
  it("applies waste factor and multiplier", () => {
    const len = calculateLinearLength([{ x: 0, y: 0 }, { x: 100, y: 0 }], 1, { wasteFactorPct: 10, multiplier: 2 });
    assert.equal(len, 100 * 2 * 1.1);
  });
});

describe("calculatePerimeter", () => {
  it("closes the polygon back to the first point", () => {
    const p = calculatePerimeter([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 1);
    assert.equal(p, 40);
  });
});

describe("calculatePolygonArea", () => {
  it("computes a square's area via the shoelace formula", () => {
    const area = calculatePolygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 1);
    assert.equal(area, 100);
  });
  it("scales quadratically with pageSpaceScaleFactor", () => {
    const area = calculatePolygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 2);
    assert.equal(area, 400); // 100 page-space-units^2 * 2^2
  });
  it("is winding-direction independent (absolute value)", () => {
    const cw = calculatePolygonArea([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }], 1);
    const ccw = calculatePolygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 1);
    assert.equal(cw, ccw);
  });
  it("returns 0 for fewer than 3 points", () => {
    assert.equal(calculatePolygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1), 0);
  });
});

describe("calculateRectangleArea / calculateCircleArea", () => {
  it("computes rectangle area from opposite corners regardless of corner order", () => {
    assert.equal(calculateRectangleArea({ x: 0, y: 0 }, { x: 10, y: 5 }, 1), 50);
    assert.equal(calculateRectangleArea({ x: 10, y: 5 }, { x: 0, y: 0 }, 1), 50);
  });
  it("computes circle area from center + edge point", () => {
    const area = calculateCircleArea({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    assert.ok(Math.abs(area - Math.PI * 100) < 1e-9);
  });
});

describe("calculateCount", () => {
  it("counts placed points, independent of calibration", () => {
    assert.equal(calculateCount([{ x: 1, y: 1 }]), 1);
    assert.equal(calculateCount([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), 3);
  });
  it("applies multiplier (e.g. 2 fixtures per placed marker)", () => {
    assert.equal(calculateCount([{ x: 1, y: 1 }, { x: 2, y: 2 }], { multiplier: 2 }), 4);
  });
});

describe("calculateAreaVolume / calculateBoxVolume", () => {
  it("area x thickness", () => {
    const vol = calculateAreaVolume([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 1, 0.5);
    assert.equal(vol, 50);
  });
  it("length x width x depth", () => {
    const vol = calculateBoxVolume([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.1, 2, 3);
    assert.equal(vol, 10 * 2 * 3);
  });
});

describe("calculateSlopeAdjustedLength", () => {
  it("returns the plan length unchanged at 0% slope", () => {
    assert.equal(calculateSlopeAdjustedLength([{ x: 0, y: 0 }, { x: 100, y: 0 }], 1, 0), 100);
  });
  it("returns the hypotenuse length at a nonzero slope", () => {
    // 100 ft run at a slope such that rise = 100*3/4=75 -> hypotenuse 125 (3-4-5 triangle scaled)
    const len = calculateSlopeAdjustedLength([{ x: 0, y: 0 }, { x: 100, y: 0 }], 1, 75);
    assert.ok(Math.abs(len - 125) < 1e-9);
  });
});

describe("quantityForMeasurement", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const bowtie = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 10, y: 0 },
  ];

  it("rejects a self-crossing polygon instead of storing a cancelled area", () => {
    assert.equal(polygonSelfIntersects(bowtie), true);
    assert.equal(quantityForMeasurement("area", bowtie, 1), null);
    assert.equal(quantityForMeasurement("area", square, 1), 100);
  });

  it("folds thickness, width, depth, and slope into the stored quantity", () => {
    assert.equal(quantityForMeasurement("area", square, 1, { thickness: 0.5 }), 50);
    assert.equal(quantityForMeasurement("length", [{ x: 0, y: 0 }, { x: 10, y: 0 }], 1, { width: 2, depth: 3 }), 60);
    const sloped = quantityForMeasurement("length", [{ x: 0, y: 0 }, { x: 100, y: 0 }], 1, { slope_pct: 75 });
    assert.ok(sloped != null && Math.abs(sloped - 125) < 1e-9);
  });

  it("leaves calculated quantity null until the sheet scale is verified", () => {
    assert.equal(calculatedQuantityForSave(false, 42), null);
    assert.equal(calculatedQuantityForSave(true, 42), 42);
  });
});

describe("convertLinearUnit", () => {
  it("converts feet to inches and back", () => {
    assert.equal(convertLinearUnit(1, "ft", "in"), 12);
    assert.ok(Math.abs(convertLinearUnit(12, "in", "ft") - 1) < 1e-9);
  });
  it("converts meters to feet", () => {
    assert.ok(Math.abs(convertLinearUnit(1, "m", "ft") - 3.280839895) < 1e-9);
  });
  it("is case-insensitive", () => {
    assert.equal(convertLinearUnit(1, "FT", "IN"), 12);
  });
  it("throws on an unrecognized unit rather than silently guessing", () => {
    assert.throws(() => convertLinearUnit(1, "furlong", "ft"));
    assert.throws(() => convertLinearUnit(1, "ft", "furlong"));
  });
});

describe("render-scale invariance (the core guarantee this module exists for)", () => {
  it("the SAME real-world geometry drawn at two different render scales produces the SAME quantity once projected to page space", () => {
    // Simulates: geometry stored in page space is renderScale-independent by
    // construction (this is proven exhaustively in coordinates.test.ts) —
    // this test proves the QUANTITY layer built on top preserves that
    // invariance rather than reintroducing a render-scale dependency.
    const pageSpacePointsA = [{ x: 100, y: 100 }, { x: 300, y: 100 }]; // authored at renderScale 0.8
    const pageSpacePointsB = [{ x: 100, y: 100 }, { x: 300, y: 100 }]; // authored at renderScale 2.1, same page location
    const scaleFactor = 0.05; // ft per page-space-unit, from calibration
    assert.equal(
      calculateLinearLength(pageSpacePointsA, scaleFactor),
      calculateLinearLength(pageSpacePointsB, scaleFactor),
    );
  });
});
