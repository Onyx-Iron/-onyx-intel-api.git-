import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { triangulate, triangleFillPath } from "./tessellate.ts";

describe("takeoff tessellation", () => {
  it("fills a concave six-sided notch as four triangles", () => {
    const notch = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    const triangles = triangulate(notch);
    assert.equal(triangles.length, 4);
    const path = triangleFillPath(notch);
    assert.match(path, /^M/);
    assert.equal(path.split(" Z").length - 1, 4);
  });
});
