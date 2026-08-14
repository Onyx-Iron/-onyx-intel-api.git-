import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canClaimCertified, evaluateCapability } from "./certification";

describe("takeoff capability certification", () => {
  const boundary = { tradeFamily: "concrete", sourceType: "vector_pdf", quantityType: "area" };

  it("blocks empty, unreviewed, unverifiable, or incomplete evidence", () => {
    assert.equal(evaluateCapability({ fixtures: 0 }).status, "blocked");
    assert.deepEqual(
      evaluateCapability({
        fixtures: 12,
        reviewedFixtures: 0,
        verifiedSourceFixtures: 12,
        qualifiedReviewerFixtures: 0,
        recall: 0.98,
        precision: 0.99,
        unitAccuracy: 1,
        scopeCompleteness: 0.97,
        maxQuantityError: 0.01,
        boundary,
      }).reasons,
      ["no_qualified_reviewed_fixtures"],
    );
    assert.equal(evaluateCapability({
      fixtures: 12,
      reviewedFixtures: 12,
      verifiedSourceFixtures: 0,
      qualifiedReviewerFixtures: 12,
      recall: 0.98,
      precision: 0.99,
      unitAccuracy: 1,
      scopeCompleteness: 0.97,
      maxQuantityError: 0.01,
      boundary,
    }).status, "blocked");
  });

  it("certifies only passing, reviewed, source-verified boundaries", () => {
    const certification = evaluateCapability({
      fixtures: 12,
      reviewedFixtures: 12,
      verifiedSourceFixtures: 12,
      qualifiedReviewerFixtures: 12,
      recall: 0.98,
      precision: 0.99,
      unitAccuracy: 1,
      scopeCompleteness: 0.97,
      maxQuantityError: 0.01,
      boundary,
    });
    assert.equal(certification.status, "certified");
    assert.equal(evaluateCapability({
      fixtures: 12,
      reviewedFixtures: 12,
      verifiedSourceFixtures: 12,
      qualifiedReviewerFixtures: 12,
      recall: 0.8,
      precision: 0.99,
      unitAccuracy: 1,
      scopeCompleteness: 0.97,
      maxQuantityError: 0.01,
      boundary,
    }).status, "provisional");
  });

  it("never extends certification beyond its exact trade/source/quantity boundary", () => {
    const certification = { status: "certified" as const, boundary: { tradeFamily: "concrete", sourceType: "vector_pdf", quantityType: "area" } };
    assert.equal(canClaimCertified(certification.boundary, certification), true);
    assert.equal(canClaimCertified({ ...certification.boundary, sourceType: "scanned_pdf" }, certification), false);
  });
});
