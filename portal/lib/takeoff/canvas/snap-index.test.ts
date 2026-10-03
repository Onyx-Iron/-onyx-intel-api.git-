import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSnapIndex, nearestSnap } from "./snap-index.ts";

describe("snap index", () => {
  it("returns the vertex inside a 12px radius and ignores the one outside it", () => {
    const index = buildSnapIndex([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 8, y: 0 },
    ]);
    assert.deepEqual(nearestSnap(index, 3, 1, 12), { x: 0, y: 0 });
    assert.equal(nearestSnap(index, 40, 40, 12), null);
  });
});
