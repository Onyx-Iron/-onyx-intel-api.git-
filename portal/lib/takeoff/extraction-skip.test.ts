import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countAlreadyDecided, visionItemKey } from "./extraction-skip.ts";

describe("vision extraction identity", () => {
  it("folds case, whitespace, and sub-ten-thousandths into one key", () => {
    const spaced = visionItemKey({ description: "  Catch Basin ", quantity: 1.00004, unit: "EA" });
    const compact = visionItemKey({ description: "catch basin", quantity: 1, unit: " ea " });
    assert.equal(spaced, "catch basin|1.0000|ea");
    assert.equal(spaced, compact);
  });

  it("treats a missing quantity as zero and keeps a real quantity distinct", () => {
    const missing = visionItemKey({ description: "Pipe", quantity: null, unit: "LF" });
    const zero = visionItemKey({ description: "Pipe", quantity: 0, unit: "LF" });
    const measured = visionItemKey({ description: "Pipe", quantity: 0.0001, unit: "LF" });
    assert.equal(missing, "pipe|0.0000|lf");
    assert.equal(missing, zero);
    assert.equal(measured, "pipe|0.0001|lf");
    assert.notEqual(missing, measured);
  });

  it("counts an item only when its key was already decided", () => {
    const pipe = { description: "Pipe", quantity: 10.2, unit: "LF" };
    const basin = { description: "Basin", quantity: 2, unit: "EA" };
    const decided = [
      `  ${visionItemKey(pipe).toUpperCase()}  `,
      visionItemKey({ description: "Other", quantity: 1, unit: "EA" }),
    ];
    assert.equal(countAlreadyDecided([pipe, basin, pipe], decided), 2);
    assert.equal(countAlreadyDecided([basin], []), 0);
  });
});
