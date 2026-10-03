import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ingestTreatsAsInFlight, INGEST_IN_FLIGHT_MS, shouldMarkIngestStartError } from "./ingest-start.ts";

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

describe("ingestTreatsAsInFlight", () => {
  const now = Date.parse("2026-10-03T09:00:00.000Z");

  it("does not skip a pending direct upload that has not been claimed", () => {
    assert.equal(ingestTreatsAsInFlight("pending", null, now), false);
    assert.equal(ingestTreatsAsInFlight("pending", new Date(now).toISOString(), now), false);
  });

  it("skips when complete has just stamped processing itself", () => {
    assert.equal(ingestTreatsAsInFlight("processing", new Date(now).toISOString(), now + 1000), true);
  });

  it("allows a retry after the in-flight window", () => {
    const started = new Date(now - INGEST_IN_FLIGHT_MS - 1).toISOString();
    assert.equal(ingestTreatsAsInFlight("processing", started, now), false);
  });
});
