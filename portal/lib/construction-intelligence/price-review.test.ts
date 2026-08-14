import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPriceReviewPayload, buildPriceReviewPreview } from "./price-review";

describe("price evidence review", () => {
  const evidence = { id: "price-1", approval_status: "unreviewed", source_kind: "project_quote", material_cost: 12 };

  it("builds a stable exact preview for authoritative non-AI evidence", () => {
    const first = buildPriceReviewPreview(evidence, "approved", "Quote checked");
    const second = buildPriceReviewPreview({ ...evidence }, "approved", "Quote checked");
    assert.equal(first.payloadHash, second.payloadHash);
    assert.equal(first.payload.authoritativeAfterReview, true);
  });

  it("keeps reviewed AI estimates explicitly non-authoritative", () => {
    const payload = buildPriceReviewPayload({ ...evidence, source_kind: "ai_estimate" }, "approved", "Reviewed assumption");
    assert.equal(payload.authoritativeAfterReview, false);
  });

  it("requires a rejection reason and refuses repeat review", () => {
    assert.throws(() => buildPriceReviewPayload(evidence, "rejected", ""), /reason/i);
    assert.throws(() => buildPriceReviewPayload({ ...evidence, approval_status: "approved" }, "approved", ""), /unreviewed/i);
  });
});
