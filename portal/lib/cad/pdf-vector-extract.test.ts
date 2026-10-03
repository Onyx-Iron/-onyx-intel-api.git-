import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nearestText, nearestTextInGrid, textTokenGrid } from "./pdf-vector-extract.ts";

describe("nearest text grid", () => {
  it("matches a full scan inside the search radius and ignores labels farther away", () => {
    const tokens = [
      { text: "near", x: 10, y: 10 },
      { text: "far", x: 500, y: 500 },
      { text: "edge", x: 59, y: 10 },
    ];
    const grid = textTokenGrid(tokens, 50);
    assert.equal(nearestTextInGrid(12, 12, grid, 50, 50)?.text, nearestText(12, 12, tokens, 50)?.text);
    assert.equal(nearestTextInGrid(12, 12, grid, 50, 50)?.text, "near");
    assert.equal(nearestTextInGrid(0, 0, grid, 50, 50)?.text, nearestText(0, 0, tokens, 50)?.text);
    assert.equal(nearestText(12, 12, tokens, 50)?.text, "near");
    assert.equal(nearestTextInGrid(200, 200, grid, 50, 50), null);
  });
});
