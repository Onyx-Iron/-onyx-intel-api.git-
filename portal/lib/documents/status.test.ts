import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_FAILURE,
  CANONICAL_SUCCESS,
  finalizeAsyncDocumentStatus,
  isInFlightStatus,
  isRetryable,
  isTerminalFailure,
  isTerminalSuccess,
  needsSplitStatusPoll,
  normalizeStatusForDisplay,
  statusLabel,
} from "./status.ts";

describe("document status helpers", () => {
  it("classifies terminal and in-flight statuses", () => {
    assert.equal(isTerminalSuccess("complete"), true);
    assert.equal(isTerminalSuccess("done"), true);
    assert.equal(isTerminalSuccess("complete_with_errors"), true);
    assert.equal(isTerminalFailure("failed"), true);
    assert.equal(isTerminalFailure("error"), true);
    assert.equal(isInFlightStatus("split"), true);
    assert.equal(isInFlightStatus("complete"), false);
  });

  it("labels async statuses for the UI", () => {
    assert.equal(statusLabel("split"), "Splitting pages");
    assert.equal(statusLabel("failed"), "Failed");
  });

  it("polls split-status while split pipeline is active", () => {
    assert.equal(needsSplitStatusPoll({ status: "split" }), true);
    assert.equal(needsSplitStatusPoll({ status: "complete" }), false);
    assert.equal(needsSplitStatusPoll({ status: "processing", split_status: "pending" }), true);
  });

  it("treats failed and partial documents as retryable", () => {
    assert.equal(isRetryable("failed"), true);
    assert.equal(isRetryable("error"), true);
    assert.equal(isRetryable("complete_with_errors"), true);
    assert.equal(isRetryable("complete"), false);
  });

  it("normalizes legacy async statuses", () => {
    assert.equal(normalizeStatusForDisplay("done"), CANONICAL_SUCCESS);
    assert.equal(normalizeStatusForDisplay("failed"), CANONICAL_FAILURE);
  });

  it("finalizes async document status", () => {
    assert.equal(finalizeAsyncDocumentStatus({ allFailed: true, partialErrors: false }), CANONICAL_FAILURE);
    assert.equal(finalizeAsyncDocumentStatus({ allFailed: false, partialErrors: true }), "complete_with_errors");
    assert.equal(finalizeAsyncDocumentStatus({ allFailed: false, partialErrors: false }), CANONICAL_SUCCESS);
  });
});
