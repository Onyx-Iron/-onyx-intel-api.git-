import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldMarkIngestStartError, shouldRetryUploadComplete } from "./ingest-start.ts";

describe("shouldMarkIngestStartError", () => {
  it("treats queued and completed ingest responses as success", () => {
    assert.equal(shouldMarkIngestStartError(200), false);
    assert.equal(shouldMarkIngestStartError(202), false);
  });

  it("leaves an in-flight claim alone", () => {
    assert.equal(shouldMarkIngestStartError(409), false);
  });

  it("retries a dropped or server-side complete call", () => {
    assert.equal(shouldRetryUploadComplete(null, 0), true);
    assert.equal(shouldRetryUploadComplete(502, 0), true);
    assert.equal(shouldRetryUploadComplete(409, 0), false);
    assert.equal(shouldRetryUploadComplete(500, 2), false);
  });

  it("marks real start failures", () => {
    assert.equal(shouldMarkIngestStartError(400), true);
    assert.equal(shouldMarkIngestStartError(412), true);
    assert.equal(shouldMarkIngestStartError(500), true);
    assert.equal(shouldMarkIngestStartError(503), true);
  });
});
