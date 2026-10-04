import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { previewRecalibration, recalibrationNeedsConfirm } from "./recalibration.ts";

describe("recalibration preview", () => {
  it("scales length and perimeter linearly, area by the square, and leaves counts", () => {
    const lines = previewRecalibration(
      [
        { id: "l", takeoff_type: "length", quantity: 10, label: "Wall" },
        { id: "p", takeoff_type: "perimeter", quantity: 40 },
        { id: "a", takeoff_type: "area", quantity: 100, label: "Slab" },
        { id: "c", takeoff_type: "count", quantity: 4, label: "Doors" },
      ],
      1,
      2,
    );
    assert.equal(lines[0].after, 20);
    assert.equal(lines[1].after, 80);
    assert.equal(lines[2].after, 400);
    assert.equal(lines[3].after, 4);
    assert.equal(lines[3].recomputed, false);
    assert.equal(recalibrationNeedsConfirm(lines), true);
  });

  it("does not invent quantities when the old scale factor is missing", () => {
    const lines = previewRecalibration(
      [{ id: "l", takeoff_type: "length", quantity: 10 }],
      null,
      2,
    );
    assert.equal(lines[0].after, 10);
    assert.equal(lines[0].recomputed, false);
    assert.equal(recalibrationNeedsConfirm(lines), false);
  });
});
