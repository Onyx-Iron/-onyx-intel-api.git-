import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ingestStampIsLive, shouldMarkIngestStartError, shouldSkipLiveIngest } from "./ingest-start.ts";

describe("shouldMarkIngestStartError", () => {
  it("treats queued and completed ingest responses as success", () => {
    assert.equal(shouldMarkIngestStartError(200), false);
    assert.equal(shouldMarkIngestStartError(202), false);
  });

  it("leaves an in-flight claim alone", () => {
    assert.equal(shouldMarkIngestStartError(409), false);
  });

  it("marks real start failures", () => {
    assert.equal(shouldMarkIngestStartError(400), true);
    assert.equal(shouldMarkIngestStartError(412), true);
    assert.equal(shouldMarkIngestStartError(500), true);
    assert.equal(shouldMarkIngestStartError(503), true);
  });
});

describe("ingest claim", () => {
  const now = Date.parse("2026-10-04T01:52:01.077Z");

  it("does not treat a pending upload's stamp as an in-flight ingest", () => {
    assert.equal(ingestStampIsLive("pending", "2026-10-04T01:52:01.000Z", now), false);
    assert.equal(ingestStampIsLive("error", "2026-10-04T01:52:01.000Z", now), false);
    assert.equal(ingestStampIsLive("processing", null, now), false);
  });

  it("treats a fresh processing stamp as live and an old one as free", () => {
    assert.equal(ingestStampIsLive("processing", "2026-10-04T01:52:00.000Z", now), true);
    assert.equal(ingestStampIsLive("processing", "2026-10-04T01:40:00.000Z", now), false);
  });

  it("starts ingest when upload complete pre-stamped the row and no claim exists", () => {
    const stampIsLive = ingestStampIsLive("processing", "2026-10-04T01:52:01.000Z", now);
    assert.equal(shouldSkipLiveIngest(stampIsLive, false), false);
    assert.equal(shouldSkipLiveIngest(stampIsLive, true), true);
  });
});
