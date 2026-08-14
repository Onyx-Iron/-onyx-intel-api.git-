import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashApprovalPayload, validateApprovalPreview } from "./approval-preview";

const payload = { candidateVersions: [{ id: "b", version: 2 }, { id: "a", version: 1 }], quantity: 12.5, unit: "LF" };

describe("immutable takeoff approval previews", () => {
  it("hashes canonical content independent of object key order", () => {
    assert.equal(hashApprovalPayload(payload), hashApprovalPayload({ unit: "LF", quantity: 12.5, candidateVersions: payload.candidateVersions }));
  });

  it("rejects expiry, actor changes, and candidate mutation", () => {
    const preview = { payloadHash: hashApprovalPayload(payload), payload, expiresAt: "2026-08-14T01:00:00Z", actorUserId: "u1" };
    assert.deepEqual(validateApprovalPreview(preview, { now: new Date("2026-08-14T02:00:00Z"), actorUserId: "u1", payload }), { valid: false, reason: "expired" });
    assert.deepEqual(validateApprovalPreview(preview, { now: new Date("2026-08-14T00:00:00Z"), actorUserId: "u2", payload }), { valid: false, reason: "wrong_actor" });
    assert.deepEqual(validateApprovalPreview(preview, { now: new Date("2026-08-14T00:00:00Z"), actorUserId: "u1", payload: { ...payload, quantity: 13 } }), { valid: false, reason: "candidate_changed" });
  });
});
