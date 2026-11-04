import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiCreditGrant, billingPeriodEnded } from "./credit-grant.ts";

const NOW = Date.parse("2026-11-04T00:00:00.000Z");
const PERIOD_END = "2026-12-04T00:00:00.000Z";
const NEXT_PERIOD_END = "2027-01-04T00:00:00.000Z";

describe("ai credit grant", () => {
  it("grants the plan allotment on the first active subscription", () => {
    const grant = aiCreditGrant({
      status: "active",
      periodEndsAt: PERIOD_END,
      storedResetAt: null,
      previousTier: "trial",
      nextTier: "solo",
      nextCredits: 100,
      nowMs: NOW,
    });
    assert.deepEqual(grant, {
      ai_credits_remaining: 100,
      ai_credits_reset_at: PERIOD_END,
    });
  });

  it("keeps used credits when the same billing period is updated again", () => {
    const grant = aiCreditGrant({
      status: "active",
      periodEndsAt: PERIOD_END,
      storedResetAt: "2026-12-04T00:00:00Z",
      previousTier: "solo",
      nextTier: "solo",
      nextCredits: 100,
      nowMs: NOW,
    });
    assert.equal(grant, null);
  });

  it("refills when the billing period end moves forward", () => {
    const grant = aiCreditGrant({
      status: "active",
      periodEndsAt: NEXT_PERIOD_END,
      storedResetAt: PERIOD_END,
      previousTier: "solo",
      nextTier: "solo",
      nextCredits: 100,
      nowMs: NOW,
    });
    assert.equal(grant?.ai_credits_remaining, 100);
    assert.equal(grant?.ai_credits_reset_at, NEXT_PERIOD_END);
  });

  it("refills on an upgrade inside the current period", () => {
    const grant = aiCreditGrant({
      status: "active",
      periodEndsAt: PERIOD_END,
      storedResetAt: PERIOD_END,
      previousTier: "solo",
      nextTier: "crew",
      nextCredits: 500,
      nowMs: NOW,
    });
    assert.equal(grant?.ai_credits_remaining, 500);
  });

  it("does not refill a cancellation or a past-due update", () => {
    const shared = {
      periodEndsAt: PERIOD_END,
      storedResetAt: PERIOD_END,
      previousTier: "solo" as const,
      nextTier: "solo" as const,
      nextCredits: 100,
      nowMs: NOW,
    };
    assert.equal(aiCreditGrant({ ...shared, status: "canceled" }), null);
    assert.equal(aiCreditGrant({ ...shared, status: "past_due" }), null);
  });

  it("treats a passed period end as ended", () => {
    assert.equal(billingPeriodEnded("2026-11-01T00:00:00.000Z", NOW), true);
    assert.equal(billingPeriodEnded(PERIOD_END, NOW), false);
    assert.equal(billingPeriodEnded(null, NOW), false);
  });
});
