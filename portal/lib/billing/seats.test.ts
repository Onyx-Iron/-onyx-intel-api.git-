import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveSeatLimit, occupiedSeatCount, seatLimitReached } from "./plans.ts";

describe("effectiveSeatLimit", () => {
  it("uses the paid catalog when the stored cap is still the trial default", () => {
    assert.equal(effectiveSeatLimit({ planTier: "crew", storedSeatLimit: 1 }), 5);
    assert.equal(effectiveSeatLimit({ planTier: "business", storedSeatLimit: 1 }), 15);
    assert.equal(effectiveSeatLimit({ planTier: "enterprise", storedSeatLimit: 1 }), -1);
  });

  it("keeps an explicit override that is not the trial default", () => {
    assert.equal(effectiveSeatLimit({ planTier: "crew", storedSeatLimit: 8 }), 8);
    assert.equal(effectiveSeatLimit({ planTier: "business", storedSeatLimit: 3 }), 3);
  });

  it("keeps the trial and solo caps at one seat", () => {
    assert.equal(effectiveSeatLimit({ planTier: "trial", storedSeatLimit: 1 }), 1);
    assert.equal(effectiveSeatLimit({ planTier: "solo", storedSeatLimit: 1 }), 1);
    assert.equal(effectiveSeatLimit({ planTier: "unknown", storedSeatLimit: null }), 1);
  });

  it("drops the cap while a comp grant is active", () => {
    const now = Date.parse("2026-11-04T00:00:00Z");
    assert.equal(effectiveSeatLimit({
      planTier: "trial",
      storedSeatLimit: 1,
      compUntil: "2026-12-01T00:00:00Z",
      now,
    }), -1);
    assert.equal(effectiveSeatLimit({
      planTier: "crew",
      storedSeatLimit: 5,
      compUntil: "2026-10-01T00:00:00Z",
      now,
    }), 5);
  });
});

describe("occupied seats", () => {
  it("counts members and pending invitations together", () => {
    assert.equal(occupiedSeatCount(4, 1), 5);
    assert.equal(seatLimitReached(5, 5), true);
    assert.equal(seatLimitReached(4, 5), false);
    assert.equal(seatLimitReached(100, -1), false);
  });
});
