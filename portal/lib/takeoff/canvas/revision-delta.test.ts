import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareRevisionQuantities } from "./revision-delta.ts";

describe("compareRevisionQuantities", () => {
  it("sums a cost code and unit and keeps a code that exists on only one revision", () => {
    const rows = compareRevisionQuantities(
      [
        { cost_code: "22-11-00", unit: "LF", quantity: 40 },
        { cost_code: "22-11-00", unit: "lf", quantity: 10 },
        { cost_code: null, unit: "EA", quantity: 2 },
      ],
      [
        { cost_code: "22-11-00", unit: "LF", quantity: 80 },
        { cost_code: "03-30-00", unit: "CY", quantity: 6 },
      ],
    );
    assert.deepEqual(rows, [
      { cost_code: "03-30-00", unit: "CY", prior: 0, current: 6, delta: 6 },
      { cost_code: "22-11-00", unit: "LF", prior: 50, current: 80, delta: 30 },
      { cost_code: "Unassigned", unit: "EA", prior: 2, current: 0, delta: -2 },
    ]);
  });
});
