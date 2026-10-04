import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateLinearLength, calculatePolygonArea } from "./canvas/quantity.ts";
import {
  applyManualScale,
  feetPerPointFromPrintedScale,
  regionForPoint,
  scaleRegionsFromMarks,
} from "./stated-scale.ts";
import { countRepeatedMarks, measurePageGeometry, measurementRequestsModel } from "./measure-geometry.ts";

const PAGE = { width: 612, height: 792 };

describe("printed scale", () => {
  it("converts 1 inch = 20 feet into feet per PDF point", () => {
    const scale = feetPerPointFromPrintedScale('SCALE: 1" = 20\'');
    assert.ok(scale);
    assert.ok(Math.abs(scale.pageSpaceScaleFactor - 20 / 72) < 1e-12);
  });

  it("converts an architectural fraction and a metric ratio", () => {
    const eighth = feetPerPointFromPrintedScale('1/8" = 1\'-0"');
    assert.ok(eighth);
    assert.ok(Math.abs(eighth.pageSpaceScaleFactor - 8 / 72) < 1e-12);
    const ratio = feetPerPointFromPrintedScale("1:100");
    assert.ok(ratio);
    assert.ok(Math.abs(ratio.pageSpaceScaleFactor - (100 / 12) / 72) < 1e-12);
  });

  it("does not invent a factor when the sheet prints no scale", () => {
    assert.equal(feetPerPointFromPrintedScale("FLOOR PLAN"), null);
    assert.deepEqual(scaleRegionsFromMarks([{ text: "FLOOR PLAN", x: 40, y: 40 }], PAGE), []);
  });

  it("keeps two printed scales on separate regions", () => {
    const regions = scaleRegionsFromMarks([
      { text: 'SCALE: 1" = 20\'', x: 50, y: 40 },
      { text: 'SCALE: 1" = 10\'', x: 400, y: 40 },
    ], PAGE);
    assert.equal(regions.length, 2);
    assert.notEqual(regions[0].pageSpaceScaleFactor, regions[1].pageSpaceScaleFactor);
    const left = regionForPoint({ x: 80, y: 200 }, regions);
    const right = regionForPoint({ x: 450, y: 200 }, regions);
    assert.equal(left?.scaleText.includes("20"), true);
    assert.equal(right?.scaleText.includes("10"), true);
  });

  it("replaces only the region a manual check falls in", () => {
    const regions = scaleRegionsFromMarks([
      { text: '1" = 20\'', x: 50, y: 40 },
      { text: '1" = 10\'', x: 400, y: 40 },
    ], PAGE);
    const next = applyManualScale(regions, { x: 80, y: 200 }, 0.5, "manual 36 ft", PAGE);
    const left = next.find((region) => region.bounds.maxX < 300);
    const right = next.find((region) => region.bounds.minX > 200);
    assert.equal(left?.source, "manual");
    assert.equal(left?.verified, true);
    assert.equal(left?.pageSpaceScaleFactor, 0.5);
    assert.equal(right?.source, "stated_on_sheet");
    assert.ok(Math.abs((right?.pageSpaceScaleFactor ?? 0) - 10 / 72) < 1e-12);
  });
});

describe("measured geometry", () => {
  it("measures a 144-point line at 1 inch = 20 feet as 40 feet at any render size", () => {
    const regions = scaleRegionsFromMarks([{ text: '1" = 20\'', x: 36, y: 36 }], PAGE);
    const line = { points: [{ x: 0, y: 0 }, { x: 144, y: 0 }], closed: false };
    const [row] = measurePageGeometry([line], regions);
    assert.equal(row.quantity, 40);
    assert.equal(row.unit, "LF");
    assert.equal(row.originMethod, "stated_scale");
    const again = calculateLinearLength(line.points, regions[0].pageSpaceScaleFactor);
    assert.equal(again, 40);
  });

  it("measures a closed rectangle at 1/8 inch = 1 foot", () => {
    const regions = scaleRegionsFromMarks([{ text: '1/8" = 1\'-0"', x: 36, y: 36 }], PAGE);
    const rect = {
      points: [
        { x: 0, y: 0 },
        { x: 144, y: 0 },
        { x: 144, y: 144 },
        { x: 0, y: 144 },
      ],
      closed: true,
    };
    const [row] = measurePageGeometry([rect], regions);
    const expected = calculatePolygonArea(rect.points, 8 / 72);
    assert.equal(row.kind, "area");
    assert.equal(row.unit, "SF");
    assert.ok(Math.abs((row.quantity ?? 0) - expected) < 1e-9);
    assert.ok(Math.abs(expected - 256) < 1e-9);
  });

  it("does not apply one factor to two scales", () => {
    const regions = scaleRegionsFromMarks([
      { text: '1" = 20\'', x: 50, y: 40 },
      { text: '1" = 10\'', x: 400, y: 40 },
    ], PAGE);
    const rows = measurePageGeometry([
      { points: [{ x: 40, y: 80 }, { x: 184, y: 80 }], closed: false },
      { points: [{ x: 390, y: 80 }, { x: 534, y: 80 }], closed: false },
    ], regions);
    assert.equal(rows[0].quantity, 40);
    assert.equal(rows[1].quantity, 20);
    assert.notEqual(rows[0].pageSpaceScaleFactor, rows[1].pageSpaceScaleFactor);
  });

  it("stores geometry and withholds quantity when no scale is printed", () => {
    const [row] = measurePageGeometry(
      [{ points: [{ x: 0, y: 0 }, { x: 144, y: 0 }], closed: false }],
      [],
    );
    assert.equal(row.quantity, null);
    assert.equal(row.unit, null);
    assert.equal(row.points.length, 2);
    assert.equal(row.coordinateSystem, "page_space");
  });

  it("measures a drawing page with more than 1200 vectors", () => {
    const regions = scaleRegionsFromMarks([{ text: '1" = 20\'', x: 10, y: 10 }], PAGE);
    const paths = Array.from({ length: 1201 }, (_, index) => ({
      points: [{ x: 10, y: index }, { x: 82, y: index }],
      closed: false,
    }));
    const rows = measurePageGeometry(paths, regions);
    assert.equal(rows.length, 1201);
    assert.ok(rows.every((row) => row.quantity != null && row.quantity > 0));
  });

  it("does not turn one mark into a count of 1", () => {
    assert.equal(countRepeatedMarks([{ x: 1, y: 1 }]), null);
    const repeated = countRepeatedMarks([
      { x: 4, y: 4 },
      { x: 4.2, y: 4.1 },
      { x: 9, y: 9 },
    ]);
    assert.equal(repeated?.quantity, 2);
  });

  it("finishes with no model host and no API key", () => {
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      assert.equal(measurementRequestsModel(), false);
      const regions = scaleRegionsFromMarks([{ text: '1" = 20\'', x: 1, y: 1 }], PAGE);
      const [row] = measurePageGeometry(
        [{ points: [{ x: 0, y: 0 }, { x: 72, y: 0 }], closed: false }],
        regions,
      );
      assert.equal(row.quantity, 20);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
