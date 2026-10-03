import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractScreenVertices, getNearestVectorPoint } from "./vector-snap";

describe("getNearestVectorPoint", () => {
  const vertices = [
    { x: 100, y: 100 },
    { x: 200, y: 200 },
    { x: 300, y: 100 },
  ];

  it("snaps when cursor is within threshold", () => {
    const result = getNearestVectorPoint({ x: 105, y: 98 }, vertices, 12);
    assert.equal(result.snapped, true);
    assert.deepEqual(result.point, { x: 100, y: 100 });
    assert.ok(result.distance <= 12);
  });

  it("does not snap when cursor is outside threshold", () => {
    const cursor = { x: 150, y: 150 };
    const result = getNearestVectorPoint(cursor, vertices, 12);
    assert.equal(result.snapped, false);
    assert.deepEqual(result.point, cursor);
  });

  it("returns cursor unchanged when no vector points exist", () => {
    const cursor = { x: 50, y: 50 };
    const result = getNearestVectorPoint(cursor, [], 12);
    assert.equal(result.snapped, false);
    assert.deepEqual(result.point, cursor);
  });
});

describe("extractScreenVertices", () => {
  it("projects world-unit vectors to screen space", () => {
    const screen = extractScreenVertices(
      [{ points: [[0, 0], [10, 0], [10, 10]] }],
      { w: 400, h: 300 },
    );
    assert.equal(screen.length, 3);
    assert.ok(screen.every((p) => p.x >= 0 && p.y >= 0));
  });
});
