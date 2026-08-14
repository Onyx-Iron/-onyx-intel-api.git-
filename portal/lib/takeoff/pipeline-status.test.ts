import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { finalSplitStatus, isSplitStartStale, SPLIT_START_TIMEOUT_MS } from "./pipeline-status.ts";

describe("takeoff pipeline status", () => {
  it("marks a nonterminal split stale after the recovery deadline", () => {
    const nowMs = Date.parse("2026-08-06T12:10:00Z");
    assert.equal(isSplitStartStale({
      status: "pending",
      updatedAt: new Date(nowMs - SPLIT_START_TIMEOUT_MS - 1).toISOString(),
      nowMs,
    }), true);
    assert.equal(isSplitStartStale({
      status: "processing",
      updatedAt: new Date(nowMs - 60_000).toISOString(),
      nowMs,
    }), false);
  });

  it("never changes terminal or malformed status timestamps", () => {
    assert.equal(isSplitStartStale({ status: "complete", updatedAt: "2020-01-01" }), false);
    assert.equal(isSplitStartStale({ status: "pending", updatedAt: "invalid" }), false);
  });

  it("only finalizes after every page reaches a terminal state", () => {
    assert.equal(finalSplitStatus(4, 0, 5), null);
    assert.equal(finalSplitStatus(4, 1, 5), "complete");
    assert.equal(finalSplitStatus(0, 5, 5), "error");
    assert.equal(finalSplitStatus(0, 0, 0), null);
  });
});
