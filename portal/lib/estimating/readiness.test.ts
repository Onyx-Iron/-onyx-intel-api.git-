import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processingStall } from "@/lib/documents/processing-display";
import { estimateReadiness } from "./readiness.ts";

describe("estimate readiness", () => {
  it("is ready only when every gate is clear", () => {
    const ready = estimateReadiness({
      documents: [{ status: "complete", doc_type: "drawing" }],
      sheets: [{ pageId: "p1", calibrated: true }],
      pendingReviewCount: 0,
      unpricedCount: 0,
      sourceRemovedCount: 0,
    });
    assert.equal(ready.ready, true);
    assert.deepEqual(ready.checks.map((check) => check.id), ["documents", "scale", "review", "rates", "sources"]);

    const blocked = estimateReadiness({
      documents: [{ status: "complete_with_errors", doc_type: "drawing", meta: { processing_summary: { missing_page_numbers: [2] } } }],
      sheets: [{ pageId: "p1", calibrated: false }],
      pendingReviewCount: 2,
      unpricedCount: 1,
      sourceRemovedCount: 1,
    });
    assert.equal(blocked.ready, false);
    assert.equal(blocked.checks.every((check) => !check.ok), true);
    assert.match(blocked.checks[0]?.detail ?? "", /Missing pages: 2/);
    assert.match(blocked.checks[1]?.detail ?? "", /1 sheet still needs/);
    assert.match(blocked.checks[2]?.detail ?? "", /2 AI findings still need a decision/);
    assert.match(blocked.checks[3]?.detail ?? "", /1 line stays/);
  });

  it("names a file that has been reading pages for more than five minutes", () => {
    const uploadedAt = "2026-10-03T12:00:00.000Z";
    const now = Date.parse(uploadedAt) + 5 * 60 * 1000;
    assert.equal(processingStall({ status: "processing", uploaded_at: uploadedAt }, now - 1), null);
    assert.match(
      processingStall({ status: "processing", uploaded_at: uploadedAt }, now) ?? "",
      /reading pages for more than 5 minutes/i,
    );
    assert.equal(processingStall({ status: "complete", uploaded_at: uploadedAt }, now + 60_000), null);
  });
});
