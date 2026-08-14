import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { verifyWebhookSignature } from "./paddle";

const secret = "pdl_ntfset_test_secret";
const body = JSON.stringify({ event_id: "evt_123", event_type: "subscription.updated" });
const nowMs = Date.UTC(2026, 7, 14, 10, 0, 0);

function signature(timestampSeconds: number): string {
  const digest = crypto.createHmac("sha256", secret).update(`${timestampSeconds}:${body}`).digest("hex");
  return `ts=${timestampSeconds};h1=${digest}`;
}

describe("Paddle webhook signature verification", () => {
  it("accepts a valid fresh signature", () => {
    assert.equal(verifyWebhookSignature(signature(nowMs / 1000), body, secret, nowMs), true);
  });

  it("rejects tampering, stale replay, future timestamps, and malformed timestamps", () => {
    assert.equal(verifyWebhookSignature(signature(nowMs / 1000), `${body}x`, secret, nowMs), false);
    assert.equal(verifyWebhookSignature(signature((nowMs - 301_000) / 1000), body, secret, nowMs), false);
    assert.equal(verifyWebhookSignature(signature((nowMs + 61_000) / 1000), body, secret, nowMs), false);
    assert.equal(verifyWebhookSignature("ts=not-a-time;h1=00", body, secret, nowMs), false);
  });
});
