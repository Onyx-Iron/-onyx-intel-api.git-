import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGrid, computeVolumes, sampleAxis } from "./sampling.ts";

describe("cut/fill grid volume", () => {
  it("samples the overlap through the far edge and no farther", () => {
    assert.deepEqual(sampleAxis(0, 10, 5), [0, 5, 10]);
    assert.deepEqual(sampleAxis(0, 12, 5), [0, 5, 10, 12]);
    const grid = buildGrid({ minX: 0, maxX: 10, minY: 0, maxY: 10 }, 5);
    assert.equal(grid.length, 3);
    assert.equal(grid[0].length, 3);
    assert.equal(grid[0][2].x, 10);
    assert.equal(grid[2][0].y, 10);
  });

  it("prices a uniform cut from the site area, not one cell per corner", () => {
    const xs = sampleAxis(0, 10, 5);
    const ys = sampleAxis(0, 10, 5);
    const delta = ys.map(() => xs.map(() => -1));
    const vols = computeVolumes(delta, xs, ys);
    const expectedCy = 100 / 27;
    assert.ok(Math.abs(vols.cut - expectedCy) < 1e-9);
    assert.equal(vols.fill, 0);
    assert.ok(Math.abs(vols.net + expectedCy) < 1e-9);
  });

  it("keeps a partial closing cell inside the overlap", () => {
    const xs = sampleAxis(0, 12, 5);
    const ys = sampleAxis(0, 10, 5);
    const delta = ys.map(() => xs.map(() => 2));
    const vols = computeVolumes(delta, xs, ys);
    const expectedCy = (12 * 10 * 2) / 27;
    assert.ok(Math.abs(vols.fill - expectedCy) < 1e-9);
    assert.equal(vols.cut, 0);
  });
});
