import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRetryDocumentUpdate, canRetryDocument } from "./retry.ts";

describe("document retry helpers", () => {
  it("recognizes drive-backed and storage-backed documents as retryable", () => {
    assert.equal(canRetryDocument({ drive_file_id: "drive-1", meta: null }), true);
    assert.equal(canRetryDocument({ drive_file_id: null, meta: { drive_file_id: "drive-2" } }), true);
    assert.equal(canRetryDocument({ drive_file_id: null, meta: { storage_path: "tenant/doc.pdf" } }), true);
    assert.equal(canRetryDocument({ drive_file_id: null, meta: {} }), false);
  });

  it("resets processing state when a retry starts", () => {
    const update = buildRetryDocumentUpdate("2026-08-04T12:00:00.000Z");
    assert.deepEqual(update, {
      status: "processing",
      last_error: null,
      last_error_step: null,
      processing_started_at: "2026-08-04T12:00:00.000Z",
      processing_completed_at: null,
    });
  });
});
