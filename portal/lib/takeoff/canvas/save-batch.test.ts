import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { heldForScaleMessage, planCanvasSave } from "./save-batch.ts";

describe("planCanvasSave", () => {
  it("holds utility runs and walls when the sheet has no verified scale", () => {
    const plan = planCanvasSave({
      shapes: 1,
      utilities: 2,
      topo: 0,
      areas: 0,
      walls: 1,
      pageSpaceReady: false,
    });
    assert.equal(plan.postShapes, true);
    assert.equal(plan.postUtilities, false);
    assert.equal(plan.postWalls, false);
    assert.deepEqual(plan.heldForScale, ["utility runs", "walls"]);
  });

  it("posts utility runs and walls once the sheet is scaled", () => {
    const plan = planCanvasSave({
      shapes: 0,
      utilities: 1,
      topo: 0,
      areas: 0,
      walls: 1,
      pageSpaceReady: true,
    });
    assert.equal(plan.postUtilities, true);
    assert.equal(plan.postWalls, true);
    assert.deepEqual(plan.heldForScale, []);
  });

  it("does not treat an empty save as success when only unscaled runs are waiting", () => {
    const plan = planCanvasSave({
      shapes: 0,
      utilities: 1,
      topo: 0,
      areas: 0,
      walls: 0,
      pageSpaceReady: false,
    });
    assert.equal(plan.postShapes, false);
    assert.equal(plan.postUtilities, false);
    assert.equal(plan.postTopo, false);
    assert.equal(plan.postAreas, false);
    assert.equal(plan.postWalls, false);
    assert.deepEqual(plan.heldForScale, ["utility runs"]);
    assert.match(heldForScaleMessage(plan.heldForScale, false), /were not stored/);
  });
});
