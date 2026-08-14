import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretAiCreditResult } from "./rate-limit";

describe("AI credit decisions", () => {
  it("allows a consumed generation and exposes the authoritative remainder", () => {
    assert.deepEqual(
      interpretAiCreditResult({ allowed: true, reason: "consumed", remaining: 9 }, null),
      { ok: true, remaining: 9 },
    );
  });

  it("fails closed when the monthly allowance is exhausted", () => {
    assert.deepEqual(
      interpretAiCreditResult(
        { allowed: false, reason: "no_credits", remaining: 0, reset_at: "2026-08-15T00:00:00.000Z" },
        null,
      ),
      { ok: false, reason: "no_credits", remaining: 0, resetAt: "2026-08-15T00:00:00.000Z" },
    );
  });

  it("fails closed when the database cannot enforce the allowance", () => {
    assert.deepEqual(
      interpretAiCreditResult(null, { message: "database unavailable" }),
      { ok: false, reason: "unavailable", remaining: 0 },
    );
  });
});
