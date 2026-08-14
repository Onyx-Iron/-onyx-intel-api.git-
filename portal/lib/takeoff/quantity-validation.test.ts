import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateQuantityCandidate } from "./quantity-validation";

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
