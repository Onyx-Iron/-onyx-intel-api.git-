import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canTransition, deriveJobCompletion, transitionJobState } from "./job-state";

describe("automated takeoff job state", () => {
  it("allows only declared forward and recovery transitions", () => {
    assert.equal(canTransition("uploaded", "validated"), true);
    assert.equal(canTransition("uploaded", "approved"), false);
    assert.equal(canTransition("failed_retryable", "extracted"), true);
    assert.equal(canTransition("estimate_imported", "approved"), false);
  });

  it("does not report completion while any in-scope unit is unresolved", () => {
    assert.deepEqual(
      deriveJobCompletion([{ state: "extracted" }, { state: "conflicted" }]),
      { complete: false, terminal: false, unresolved: 2, failed: 0 },
    );
    assert.deepEqual(
      deriveJobCompletion([{ state: "estimate_imported" }, { state: "superseded" }]),
      { complete: true, terminal: true, unresolved: 0, failed: 0 },
    );
  });

  it("counts authorized exclusions as resolved but terminal failures as visible failures", () => {
    assert.deepEqual(
      deriveJobCompletion([
        { state: "cancelled", exclusionAuthorized: true },
        { state: "failed_terminal" },
      ]),
      { complete: false, terminal: true, unresolved: 1, failed: 1 },
    );
  });

  it("rejects stale row versions and illegal state skips", () => {
    assert.throws(
      () => transitionJobState({ state: "uploaded", rowVersion: 3 }, "validated", 2),
      /row version conflict/i,
    );
    assert.throws(
      () => transitionJobState({ state: "uploaded", rowVersion: 3 }, "approved", 3),
      /invalid takeoff transition/i,
    );
    assert.deepEqual(
      transitionJobState({ state: "uploaded", rowVersion: 3 }, "validated", 3),
      { state: "validated", rowVersion: 4 },
    );
  });
});
