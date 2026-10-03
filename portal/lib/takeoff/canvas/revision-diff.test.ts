import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffRevisionVectors, polylinesFromUnknown } from "./revision-diff.ts";

describe("revision vector diff", () => {
  it("marks new geometry green-side and missing geometry red-side", () => {
    const shared = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const added = [{ x: 0, y: 5 }, { x: 8, y: 5 }];
    const removed = [{ x: 1, y: 1 }, { x: 2, y: 4 }];
    const diff = diffRevisionVectors(
      [{ points: shared }, { points: added }],
      [{ points: shared }, { points: removed }],
    );
    assert.deepEqual(diff.added, [{ points: added }]);
    assert.deepEqual(diff.removed, [{ points: removed }]);
  });

  it("reads point arrays out of stored vector records", () => {
    const lines = polylinesFromUnknown([
      { layer: "C-ROAD", points: [[1, 2], [3, 4]] },
      { points: [{ x: 1, y: 2 }] },
      { note: "skip" },
    ]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].points.length, 2);
  });
});
