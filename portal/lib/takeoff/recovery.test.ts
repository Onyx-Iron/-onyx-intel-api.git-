import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyAttempt, nextRetryAt } from "./recovery";

describe("takeoff recovery policy", () => {
  it("uses bounded exponential backoff", () => {
    const base = new Date("2026-08-14T00:00:00.000Z");
    assert.equal(nextRetryAt(base, 1).getTime(), base.getTime() + 30_000);
    assert.equal(nextRetryAt(base, 5).getTime(), base.getTime() + 480_000);
    assert.equal(nextRetryAt(base, 20).getTime(), base.getTime() + 900_000);
  });

  it("dead-letters only at the configured attempt ceiling", () => {
    assert.equal(classifyAttempt({ attempts: 7, maxAttempts: 8 }), "failed_retryable");
    assert.equal(classifyAttempt({ attempts: 8, maxAttempts: 8 }), "failed_terminal");
  });
});
