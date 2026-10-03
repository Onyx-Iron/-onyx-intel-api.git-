import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientToPageSpace, computeBoundingBox, distanceToSegment, hitTestShape,
  toPageSpace, toScreenSpace, pointsToPageSpace, pointsToScreenSpace, translateStoredPoints, translateStoredRings, samePoints,
} from "./coordinates";

describe("toPageSpace / toScreenSpace", () => {
  it("round-trips exactly at the same render scale", () => {
    const screenPt = { x: 412.5, y: 88.25 };
    const scale = 1.734;
    const page = toPageSpace(screenPt, scale);
    const back = toScreenSpace(page, scale);
    assert.ok(Math.abs(back.x - screenPt.x) < 1e-9);
    assert.ok(Math.abs(back.y - screenPt.y) < 1e-9);
  });

  it("the SAME page-space point projects to DIFFERENT screen pixels at different render scales — proving the render scale is what changes, not the stored point", () => {
    const pagePt = { x: 100, y: 200 };
    const atScale1 = toScreenSpace(pagePt, 1.0);
    const atScale2 = toScreenSpace(pagePt, 2.0);
    assert.notDeepEqual(atScale1, atScale2);
    assert.equal(atScale2.x, atScale1.x * 2);
    assert.equal(atScale2.y, atScale1.y * 2);
  });

  it("zoom invariance: a shape's page-space geometry is identical regardless of what render scale was active when it was drawn", () => {
    // Simulates: user draws a line at a small window (scale 0.8), later
    // reopens the same sheet in a wide window (scale 2.1) — the STORED
    // (page-space) geometry must be the same either way.
    const drawnAtSmallWindow = pointsToPageSpace([{ x: 80, y: 160 }, { x: 240, y: 160 }], 0.8);
    const sameRealWorldPointsAtWideWindow = pointsToPageSpace([{ x: 210, y: 420 }, { x: 630, y: 420 }], 2.1);
    // Both screen-space inputs represent the SAME underlying page location
    // (80/0.8=100, 240/0.8=300; 210/2.1=100, 630/2.1=300) — prove they
    // converge to the identical page-space geometry.
    assert.deepEqual(drawnAtSmallWindow, sameRealWorldPointsAtWideWindow);
  });

  it("pan invariance: page-space geometry does not depend on viewport scroll position (pan only affects the client-rect offset used in clientToPageSpace, never the stored point)", () => {
    const renderSize = { w: 1000, h: 800 };
    const scale = 1.5;
    // Same page location, but the SVG's bounding rect has "panned" (its
    // client-space left/top offset changed) — clientToPageSpace must
    // still resolve to the same page-space point once the client
    // coordinates are adjusted by the same offset.
    const rectA = { left: 0, top: 0, width: 1000, height: 800 };
    const rectB = { left: -250, top: -100, width: 1000, height: 800 }; // scrolled/panned
    const pageA = clientToPageSpace(500, 400, rectA, renderSize, scale);
    const pageB = clientToPageSpace(250, 300, rectB, renderSize, scale); // same page point, shifted client coords by the pan offset
    assert.ok(Math.abs(pageA.x - pageB.x) < 1e-9);
    assert.ok(Math.abs(pageA.y - pageB.y) < 1e-9);
  });

  it("throws rather than silently producing garbage for a zero or negative render scale", () => {
    assert.throws(() => toPageSpace({ x: 1, y: 1 }, 0));
    assert.throws(() => toPageSpace({ x: 1, y: 1 }, -1));
    assert.throws(() => toScreenSpace({ x: 1, y: 1 }, NaN));
  });
});

describe("pointsToPageSpace / pointsToScreenSpace", () => {
  it("maps an entire polyline consistently", () => {
    const screenPts = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }];
    const scale = 2;
    const pagePts = pointsToPageSpace(screenPts, scale);
    assert.deepEqual(pagePts, [{ x: 5, y: 10 }, { x: 15, y: 20 }, { x: 25, y: 30 }]);
    assert.deepEqual(pointsToScreenSpace(pagePts, scale), screenPts);
  });
});

describe("computeBoundingBox", () => {
  it("computes the correct bounding box for a polygon", () => {
    const box = computeBoundingBox([{ x: 5, y: 10 }, { x: -3, y: 8 }, { x: 12, y: -2 }]);
    assert.deepEqual(box, { minX: -3, minY: -2, maxX: 12, maxY: 10 });
  });

  it("returns a degenerate zero box for an empty point list rather than throwing", () => {
    assert.deepEqual(computeBoundingBox([]), { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe("distanceToSegment / hitTestShape", () => {
  it("computes zero distance for a point exactly on the segment", () => {
    assert.equal(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 0);
  });

  it("computes perpendicular distance for a point off the segment", () => {
    assert.equal(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  });

  it("clamps to the nearest endpoint when the projection falls outside the segment", () => {
    assert.equal(distanceToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  });

  it("hitTestShape finds a hit within tolerance on a multi-segment polyline", () => {
    const shape = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    assert.equal(hitTestShape({ x: 10.4, y: 5 }, shape, 1), true);
    assert.equal(hitTestShape({ x: 10.4, y: 5 }, shape, 0.2), false);
  });

  it("hitTestShape handles a single-point shape (count marker) as a radius test", () => {
    assert.equal(hitTestShape({ x: 3, y: 4 }, [{ x: 0, y: 0 }], 5), true);
    assert.equal(hitTestShape({ x: 3, y: 4 }, [{ x: 0, y: 0 }], 4.9), false);
  });

  it("hitTestShape returns false for an empty shape", () => {
    assert.equal(hitTestShape({ x: 0, y: 0 }, [], 100), false);
  });
});

describe("translateStoredPoints", () => {
  it("shifts page-space geometry by the screen drag divided by render scale", () => {
    const moved = translateStoredPoints([{ x: 10, y: 20 }], "page_space", 20, -10, 2);
    assert.deepEqual(moved, [{ x: 20, y: 15 }]);
  });

  it("shifts legacy pixel geometry by the raw screen drag", () => {
    const moved = translateStoredPoints([{ x: 10, y: 20 }, { x: 30, y: 40 }], "legacy_pixel", 5, 7, 2);
    assert.deepEqual(moved, [{ x: 15, y: 27 }, { x: 35, y: 47 }]);
  });

  it("treats a zero drag as the same stored points", () => {
    const original = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
    const moved = translateStoredPoints(original, "page_space", 0, 0, 1.5);
    assert.equal(samePoints(original, moved), true);
    assert.equal(samePoints(original, translateStoredPoints(original, "page_space", 3, 0, 1.5)), false);
    assert.equal(samePoints(original, original.slice(0, 1)), false);
  });

  it("moves a hole ring with the slab", () => {
    const moved = translateStoredRings([[{ x: 2, y: 2 }, { x: 4, y: 2 }]], "page_space", 20, -10, 2);
    assert.deepEqual(moved, [[{ x: 12, y: -3 }, { x: 14, y: -3 }]]);
  });
});
