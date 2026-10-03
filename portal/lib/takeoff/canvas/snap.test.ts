import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canvasEndpoints,
  nearestEndpoint,
  projectToCanvas,
  screenViewToWorld,
  SNAP_TOLERANCE_PX,
  unprojectFromCanvas,
  vectorCanvasFrame,
} from "./snap.ts";

describe("vector endpoint snap", () => {
  const vectors = [
    { points: [[0, 0], [10, 0]] as Array<[number, number]> },
    { points: [[10, 0], [10, 5]] as Array<[number, number]> },
  ];

  it("projects endpoints with the same fit the overlay uses", () => {
    const frame = vectorCanvasFrame(vectors, { w: 220, h: 120 });
    assert.ok(frame);
    const origin = projectToCanvas(0, 0, frame!);
    const corner = projectToCanvas(10, 5, frame!);
    assert.equal(origin.x, 20);
    assert.equal(origin.y, 100);
    assert.equal(corner.x, 180);
    assert.equal(corner.y, 20);
  });

  it("round-trips project/unproject and maps screen views to world", () => {
    const frame = vectorCanvasFrame(vectors, { w: 220, h: 120 });
    assert.ok(frame);
    const world = unprojectFromCanvas(20, 100, frame!);
    assert.ok(Math.abs(world.x - 0) < 1e-9);
    assert.ok(Math.abs(world.y - 0) < 1e-9);
    const viewWorld = screenViewToWorld({ minX: 20, minY: 20, maxX: 180, maxY: 100 }, frame!);
    assert.ok(viewWorld.minX <= 0 + 1e-9);
    assert.ok(viewWorld.maxX >= 10 - 1e-9);
    assert.ok(viewWorld.minY <= 0 + 1e-9);
    assert.ok(viewWorld.maxY >= 5 - 1e-9);
  });

  it("snaps a nearby click to the closest endpoint and ignores a far click", () => {
    const endpoints = canvasEndpoints(vectors, { w: 220, h: 120 });
    assert.equal(endpoints.length, 3);
    const hit = nearestEndpoint({ x: 24, y: 96 }, endpoints, SNAP_TOLERANCE_PX);
    assert.deepEqual(hit, { x: 20, y: 100 });
    assert.equal(nearestEndpoint({ x: 80, y: 60 }, endpoints, SNAP_TOLERANCE_PX), null);
  });

  it("picks the closer endpoint when two are inside the tolerance", () => {
    const endpoints = [{ x: 0, y: 0 }, { x: 8, y: 0 }];
    assert.deepEqual(nearestEndpoint({ x: 5, y: 0 }, endpoints, 12), { x: 8, y: 0 });
  });
});
