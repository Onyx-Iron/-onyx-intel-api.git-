import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { automatedIntakeControlFields } from "./intake-policy";

describe("bulk automated takeoff intake policy", () => {
  it("never labels browser-imported quantities as manually approved", () => {
    assert.deepEqual(automatedIntakeControlFields("ai_vision"), {
      review_status: "suggested",
      source_method: "ai_vision",
      quantity_validation_status: "unvalidated",
      approved_by: null,
      approved_at: null,
    });
    assert.equal(automatedIntakeControlFields("deterministic").review_status, "suggested");
  });
});
