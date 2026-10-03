import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STUCK_PROCESSING_MS, STUCK_QUEUED_MS } from "./reclaimStuck.ts";

describe("reclaimStuck constants", () => {
  it("uses a timeout longer than normal ingest but short enough to recover", () => {
    assert.ok(STUCK_PROCESSING_MS >= 5 * 60 * 1000);
    assert.ok(STUCK_PROCESSING_MS <= 30 * 60 * 1000);
  });

  it("allows queued docs longer than processing before reclaim", () => {
    assert.ok(STUCK_QUEUED_MS >= STUCK_PROCESSING_MS);
    assert.ok(STUCK_QUEUED_MS <= 30 * 60 * 1000);
  });
});
