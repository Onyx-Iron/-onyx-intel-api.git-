import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectSnapPoints,
  getNearestVectorPoint,
  DEFAULT_SNAP_THRESHOLD_PX,
} from "./vector-snap.ts";

describe("getNearestVectorPoint", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ];

  it("snaps when the cursor is within the default 12px threshold", () => {
    const result = getNearestVectorPoint({ x: 104, y: 3 }, vertices);
    assert.equal(result.snapped, true);
    assert.deepEqual(result.point, { x: 100, y: 0 });
    assert.ok(result.distance <= DEFAULT_SNAP_THRESHOLD_PX);
  });

  it("does not snap when every vertex is outside the threshold", () => {
    const result = getNearestVectorPoint({ x: 50, y: 50 }, vertices, 12);
    assert.equal(result.snapped, false);
    assert.deepEqual(result.point, { x: 50, y: 50 });
    assert.equal(result.distance, Infinity);
  });

  it("honors a custom threshold", () => {
    const near = getNearestVectorPoint({ x: 20, y: 0 }, vertices, 25);
    assert.equal(near.snapped, true);
    assert.deepEqual(near.point, { x: 0, y: 0 });

    const far = getNearestVectorPoint({ x: 20, y: 0 }, vertices, 10);
    assert.equal(far.snapped, false);
  });

  it("returns the original cursor when there are no vertices", () => {
    const result = getNearestVectorPoint({ x: 12, y: 8 }, []);
    assert.equal(result.snapped, false);
    assert.deepEqual(result.point, { x: 12, y: 8 });
  });

  it("picks the closest vertex when several are in range", () => {
    const result = getNearestVectorPoint({ x: 98, y: 2 }, vertices, 20);
    assert.equal(result.snapped, true);
    assert.deepEqual(result.point, { x: 100, y: 0 });
  });
});

describe("collectSnapPoints", () => {
  it("flattens polylines and dedupes near-identical vertices", () => {
    const points = collectSnapPoints([
      { points: [[0, 0], [10, 0], [10, 10]] },
      { points: [{ x: 0.04, y: 0.02 }, { x: 20, y: 20 }] },
    ]);
    assert.equal(points.length, 4);
    assert.deepEqual(points[0], { x: 0, y: 0 });
    assert.deepEqual(points[3], { x: 20, y: 20 });
  });
});
