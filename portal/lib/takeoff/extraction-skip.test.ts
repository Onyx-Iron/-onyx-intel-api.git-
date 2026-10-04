import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countAlreadyDecided, visionItemKey } from "./extraction-skip.ts";

describe("visionItemKey", () => {
  it("folds case and whitespace and keeps four decimal places", () => {
    assert.equal(
      visionItemKey({ description: " Concrete Slab ", quantity: 10.5, unit: " SF " }),
      "concrete slab|10.5000|sf",
    );
    assert.equal(
      visionItemKey({ description: "Concrete Slab", quantity: 1.23456, unit: "sf" }),
      "concrete slab|1.2346|sf",
    );
  });

  it("treats a missing or non-finite quantity as zero", () => {
    const expected = "|0.0000|";
    assert.equal(visionItemKey({}), expected);
    assert.equal(visionItemKey({ quantity: Number.NaN, description: null, unit: null }), expected);
    assert.equal(visionItemKey({ quantity: Number.POSITIVE_INFINITY }), expected);
  });
});

describe("countAlreadyDecided", () => {
  it("counts only items whose key was already approved or rejected", () => {
    const items = [
      { description: "Concrete Slab", quantity: 10.5, unit: "SF" },
      { description: "Concrete Slab", quantity: 10.5, unit: "SF" },
      { description: "Door", quantity: 2, unit: "EA" },
      { description: "Window", quantity: null, unit: "EA" },
    ];
    const decided = [
      "  Concrete Slab|10.5000|SF  ",
      "Window|0.0000|EA",
    ];

    assert.equal(countAlreadyDecided(items, decided), 3);
    assert.equal(countAlreadyDecided(items, []), 0);
    assert.equal(countAlreadyDecided([], decided), 0);
  });
});
