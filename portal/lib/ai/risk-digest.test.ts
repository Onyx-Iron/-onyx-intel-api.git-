import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bulletMentionsMoney, redactRiskDigest } from "./risk-digest.ts";

const snapshot = {
  name: "River Park",
  status: "active",
  budget: 2_500_000,
  estimate: 2_800_000,
  budget_variance: -300_000,
  open_rfis: 3,
  overdue_tasks: 2,
};

describe("redactRiskDigest", () => {
  it("leaves the digest unchanged for a role that can price a bid", () => {
    const digest = {
      risk_level: "high" as const,
      bullets: ["Budget of $2,500,000 is $300,000 under the estimate."],
      data_snapshot: snapshot,
    };
    assert.deepEqual(redactRiskDigest(digest, true), digest);
  });

  it("nulls snapshot money and drops bullets that quote it", () => {
    const digest = redactRiskDigest({
      risk_level: "high" as const,
      bullets: [
        "Budget of $2,500,000 is $300,000 under the estimate.",
        "Estimate 2800000 exceeds the budget.",
        "3 RFIs are overdue and 2 tasks passed their end date.",
      ],
      data_snapshot: snapshot,
    }, false);

    assert.equal(digest.data_snapshot?.budget, null);
    assert.equal(digest.data_snapshot?.estimate, null);
    assert.equal(digest.data_snapshot?.budget_variance, null);
    assert.equal(digest.data_snapshot?.name, "River Park");
    assert.equal(digest.data_snapshot?.open_rfis, 3);
    assert.deepEqual(digest.bullets, [
      "3 RFIs are overdue and 2 tasks passed their end date.",
    ]);
  });

  it("does not treat a small count as a budget figure", () => {
    assert.equal(bulletMentionsMoney("2 tasks are overdue", [2_500_000]), false);
    assert.equal(bulletMentionsMoney("Budget is not set", []), false);
    assert.equal(bulletMentionsMoney("Overrun of $500", []), true);
  });
});
