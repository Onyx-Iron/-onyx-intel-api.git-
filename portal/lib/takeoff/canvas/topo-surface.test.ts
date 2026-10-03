import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { topoToSurfacePoints } from "./topo-surface.ts";

describe("topo surface points", () => {
  it("turns contours and spots into feet", () => {
    const points = topoToSurfacePoints(
      [{ elevation: 410, points: [{ x: 10, y: 0 }, { x: 20, y: 0 }] }],
      [{ x: 5, y: 5, elevation: 412.5 }],
      2,
    );
    assert.equal(points.length, 3);
    assert.deepEqual(points[0], { x: 20, y: 0, z: 410 });
    assert.equal(points[2].z, 412.5);
  });
});
