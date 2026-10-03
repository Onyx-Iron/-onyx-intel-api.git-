import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shapesInView, type Box } from "./visible-shapes.ts";

function boxes(count: number): Array<{ id: number; bbox: Box }> {
  return Array.from({ length: count }, (_, id) => ({
    id,
    bbox: { minX: id * 20, minY: 0, maxX: id * 20 + 10, maxY: 10 },
  }));
}

describe("sheet shape culling", () => {
  it("keeps only boxes that meet the view", () => {
    const kept = shapesInView(boxes(10), { minX: 0, minY: 0, maxX: 30, maxY: 20 });
    assert.deepEqual(kept.map((shape) => shape.id), [0, 1]);
  });

  it("filters 100, 500, and 2000 boxes inside a frame budget", () => {
    const view = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
    const timings: Record<number, number> = {};
    for (const count of [100, 500, 2000]) {
      const shapes = boxes(count);
      const started = performance.now();
      let visible = 0;
      for (let pass = 0; pass < 50; pass += 1) visible = shapesInView(shapes, view).length;
      timings[count] = (performance.now() - started) / 50;
      assert.ok(visible > 0);
      assert.ok(visible < count);
    }
    console.log("shape cull ms", timings);
    assert.ok(timings[2000] < 20, `2000-shape cull took ${timings[2000]}ms`);
  });
});
