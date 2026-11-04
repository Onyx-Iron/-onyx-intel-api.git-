import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampProcessingEventLimit } from "./eventLimit.ts";

describe("clampProcessingEventLimit", () => {
  it("defaults a missing or non-numeric limit to 80 and caps the rest", () => {
    assert.equal(clampProcessingEventLimit(null), 80);
    assert.equal(clampProcessingEventLimit("nope"), 80);
    assert.equal(clampProcessingEventLimit("Infinity"), 80);
    assert.equal(clampProcessingEventLimit(""), 1);
    assert.equal(clampProcessingEventLimit("0"), 1);
    assert.equal(clampProcessingEventLimit("-4"), 1);
    assert.equal(clampProcessingEventLimit("1.9"), 1);
    assert.equal(clampProcessingEventLimit("80"), 80);
    assert.equal(clampProcessingEventLimit("200.8"), 200);
    assert.equal(clampProcessingEventLimit("201"), 200);
    assert.equal(clampProcessingEventLimit(" 12 "), 12);
  });
});
