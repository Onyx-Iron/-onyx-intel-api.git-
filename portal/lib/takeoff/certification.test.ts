import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canClaimCertified, evaluateCapability } from "./certification";

describe("takeoff capability certification", () => {
  it("blocks empty or incomplete evidence and certifies only passing boundaries", () => {
    assert.equal(evaluateCapability({ fixtures: 0 }).status, "blocked");
    const certification = evaluateCapability({ fixtures: 12, recall: 0.98, precision: 0.99, unitAccuracy: 1, scopeCompleteness: 0.97, maxQuantityError: 0.01 });
    assert.equal(certification.status, "certified");
    assert.equal(evaluateCapability({ fixtures: 12, recall: 0.8, precision: 0.99, unitAccuracy: 1, scopeCompleteness: 0.97, maxQuantityError: 0.01 }).status, "provisional");
  });

  it("never extends certification beyond its exact trade/source/quantity boundary", () => {
    const certification = { status: "certified" as const, boundary: { tradeFamily: "concrete", sourceType: "vector_pdf", quantityType: "area" } };
    assert.equal(canClaimCertified(certification.boundary, certification), true);
    assert.equal(canClaimCertified({ ...certification.boundary, sourceType: "scanned_pdf" }, certification), false);
  });
});
