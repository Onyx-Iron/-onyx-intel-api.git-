import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BID_STAGES, BID_STAGE_LABELS, isBidStage } from "./stages.ts";

describe("bid stages", () => {
  it("covers the full pursuit lifecycle", () => {
    assert.deepEqual([...BID_STAGES], [
      "identified", "pursuing", "takeoff", "pricing", "submitted", "won", "lost", "no_bid",
    ]);
  });

  it("labels every stage", () => {
    for (const s of BID_STAGES) {
      assert.ok(BID_STAGE_LABELS[s].length > 0);
    }
  });

  it("type-guards unknown stages", () => {
    assert.equal(isBidStage("pricing"), true);
    assert.equal(isBidStage("draft"), false);
  });
});
