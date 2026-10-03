import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applySheetTransform, fitSheetTransform } from "./georeference.ts";

describe("sheet survey tie", () => {
  it("maps two sheet points onto two state-plane points", () => {
    const transform = fitSheetTransform(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 100, y: 200 },
      { x: 110, y: 200 },
      2276,
    );
    const mapped = applySheetTransform([{ x: 0, y: 0 }, { x: 10, y: 0 }], transform);
    assert.equal(transform.epsg, 2276);
    assert.ok(Math.abs(mapped[0].x - 100) < 1e-6);
    assert.ok(Math.abs(mapped[0].y - 200) < 1e-6);
    assert.ok(Math.abs(mapped[1].x - 110) < 1e-6);
  });
});
