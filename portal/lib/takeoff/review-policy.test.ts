import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyLegacyReviewAction } from "./review-policy";

describe("legacy takeoff review policy", () => {
  it("allows non-financial review and rejection decisions", () => {
    assert.equal(classifyLegacyReviewAction("review"), "direct_review");
    assert.equal(classifyLegacyReviewAction("reject"), "direct_reject");
  });

  it("forces approvals through an immutable approval preview", () => {
    assert.equal(classifyLegacyReviewAction("approve"), "preview_required");
    assert.equal(classifyLegacyReviewAction("anything"), "invalid");
  });
});
