import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { previewRecalibration, recalibrationNeedsConfirm, recomputePageSpaceQuantities } from "./recalibration.ts";

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

describe("first calibration recomputes page-space geometry", () => {
  it("replaces a pixel length with the verified page-space quantity", () => {
    const lines = recomputePageSpaceQuantities(
      [{
        id: "wall",
        takeoff_type: "length",
        quantity: 200,
        geometry: {
          coordinate_space: "page_space",
          points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        },
      }],
      0.1,
    );
    assert.equal(lines[0].after, 10);
    assert.equal(lines[0].recomputed, true);
  });

  it("keeps counts and leaves non-page-space rows alone", () => {
    const lines = recomputePageSpaceQuantities(
      [
        {
          id: "doors",
          takeoff_type: "count",
          quantity: 3,
          geometry: {
            coordinate_space: "page_space",
            points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
          },
        },
        {
          id: "legacy",
          takeoff_type: "length",
          quantity: 40,
          geometry: { coordinate_space: "legacy_pixel", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        },
      ],
      2,
    );
    assert.equal(lines[0].after, 3);
    assert.equal(lines[0].recomputed, false);
    assert.equal(lines[1].after, 40);
    assert.equal(lines[1].recomputed, false);
  });

  it("prices a closed perimeter from page-space points, not the stored pixel length", () => {
    const lines = recomputePageSpaceQuantities(
      [{
        id: "pad",
        takeoff_type: "length",
        quantity: 40,
        geometry: {
          coordinate_space: "page_space",
          measure: "perimeter",
          points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        },
      }],
      2,
    );
    assert.equal(lines[0].after, 80);
    assert.equal(lines[0].recomputed, true);
  });
});
