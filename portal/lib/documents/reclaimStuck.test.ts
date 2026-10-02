import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STUCK_PROCESSING_MS } from "./reclaimStuck.ts";

describe("reclaimStuckProcessingDocuments constants", () => {
  it("uses a timeout longer than normal ingest but short enough to recover", () => {
    assert.ok(STUCK_PROCESSING_MS >= 5 * 60 * 1000);
    assert.ok(STUCK_PROCESSING_MS <= 30 * 60 * 1000);
  });
});
