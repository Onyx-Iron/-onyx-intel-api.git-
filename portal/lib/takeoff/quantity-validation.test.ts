import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateQuantityCandidate, validateTextQuantityCandidate } from "./quantity-validation";

const base = {
  sourceChecksum: "abc", authoritativeChecksum: "abc", manifestVersion: 2, authoritativeManifestVersion: 2,
  coordinateSpace: "page_space" as const, scaleVerified: true, pageSpaceScaleFactor: 2,
  measurementClass: "length" as const, unit: "LF", points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], submittedQuantity: 10,
};

describe("deterministic quantity candidate validation", () => {
  it("blocks unitless, guessed-scale, and stale candidates", () => {
    assert.equal(validateQuantityCandidate({ ...base, unit: "" }).status, "blocked");
    assert.deepEqual(validateQuantityCandidate({ ...base, scaleVerified: false }), { status: "blocked", reason: "scale_unverified" });
    assert.deepEqual(validateQuantityCandidate({ ...base, authoritativeManifestVersion: 3 }), { status: "blocked", reason: "stale_revision" });
  });

  it("recomputes valid arithmetic and records the formula contract", () => {
    const result = validateQuantityCandidate(base);
    assert.equal(result.status, "validated");
    assert.equal(result.quantity, 10);
    assert.equal(result.formulaVersion, "length-v1");
    assert.ok(result.calculationChecksum);
  });

  it("rejects a submitted value that differs from deterministic geometry", () => {
    assert.deepEqual(validateQuantityCandidate({ ...base, submittedQuantity: 11 }), { status: "blocked", reason: "quantity_mismatch" });
  });
});

describe("source-text quantity candidate validation", () => {
  const textBase = {
    sourceChecksum: "abc",
    authoritativeChecksum: "abc",
    manifestVersion: 2,
    authoritativeManifestVersion: 2,
    unit: "EA",
    submittedQuantity: 12,
    rawText: "DOOR TYPE A — QTY 12",
    sourceKind: "schedule" as const,
    pageNumber: 4,
  };

  it("accepts a finite quantity only when the drawing contains a quoted numeric basis", () => {
    const result = validateTextQuantityCandidate(textBase);
    assert.equal(result.status, "validated");
    assert.equal(result.quantity, 12);
    assert.equal(result.formulaVersion, "source-text-v1");
  });

  it("blocks paraphrases, stale revisions, missing units, and unsupported source kinds", () => {
    assert.deepEqual(validateTextQuantityCandidate({ ...textBase, rawText: "twelve doors" }), { status: "blocked", reason: "quantity_not_quoted" });
    assert.deepEqual(validateTextQuantityCandidate({ ...textBase, authoritativeChecksum: "new" }), { status: "blocked", reason: "stale_revision" });
    assert.deepEqual(validateTextQuantityCandidate({ ...textBase, unit: "" }), { status: "blocked", reason: "missing_unit" });
    assert.deepEqual(validateTextQuantityCandidate({ ...textBase, sourceKind: "image" as never }), { status: "blocked", reason: "unsupported_source" });
  });
});
