import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cutFillTin } from "./tin.ts";

describe("TIN cut and fill", () => {
  it("measures a flat 30 ft pad cut as 100 cubic yards", () => {
    const existing = [
      { x: 0, y: 0, z: 10 },
      { x: 30, y: 0, z: 10 },
      { x: 0, y: 30, z: 10 },
      { x: 30, y: 30, z: 10 },
    ];
    const proposed = existing.map((point) => ({ ...point, z: 7 }));
    const result = cutFillTin(existing, proposed);
    assert.ok(Math.abs(result.cut_cy - 100) < 1e-6);
    assert.equal(result.fill_cy, 0);
    assert.equal(result.low_points.length, 0);
    assert.equal(result.clipped, false);
  });

  it("drops triangles whose centroid is outside the limit of work", () => {
    const existing = [
      { x: 0, y: 0, z: 10 },
      { x: 30, y: 0, z: 10 },
      { x: 0, y: 30, z: 10 },
      { x: 30, y: 30, z: 10 },
    ];
    const proposed = existing.map((point) => ({ ...point, z: 7 }));
    const open = cutFillTin(existing, proposed);
    const clipped = cutFillTin(existing, proposed, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    assert.ok(clipped.cut_cy < open.cut_cy);
    assert.equal(clipped.clipped, true);
  });
});
