import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsReviewDecision } from "./reviewQueue.ts";

describe("reviewQueue", () => {
  it("flags suggested and reviewed items", () => {
    assert.equal(needsReviewDecision("suggested"), true);
    assert.equal(needsReviewDecision("reviewed"), true);
    assert.equal(needsReviewDecision("approved"), false);
    assert.equal(needsReviewDecision("rejected"), false);
    assert.equal(needsReviewDecision(null), false);
  });
});
