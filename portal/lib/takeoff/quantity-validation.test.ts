import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeExtractorEvidenceChecksum, validateExtractorQuantityCandidate, validateQuantityCandidate, validateTextQuantityCandidate } from "./quantity-validation";

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

describe("Python extractor quantity evidence", () => {
  const evidence = {
    measurement_class: "count" as const,
    source_kind: "schedule" as const,
    original_unit: "EA",
    normalized_unit: "EA",
    formula_version: "source-text-v1",
    calculation_inputs: { parsed_quantity: "12", raw_quantity: "12" },
    calculation_result: 12,
    source_quote: "Door schedule Qty 12",
    source_locator: "PDF p.3 col 'Qty'",
    calculation_checksum: "0cef64a36ef46a2a08d9ab6707002e2651a6a27f055586f5a26e63a2666ec1c4",
  };

  it("accepts the literal checksum emitted by the Python evidence contract", () => {
    assert.deepEqual(validateExtractorQuantityCandidate(evidence, 12, "EA"), {
      status: "validated",
      quantity: 12,
      formulaVersion: "source-text-v1",
      calculationChecksum: evidence.calculation_checksum,
    });
  });

  it("blocks missing evidence and any tampered result, unit, input, quote, locator, or checksum", () => {
    assert.deepEqual(validateExtractorQuantityCandidate(null, 12, "EA"), { status: "blocked", reason: "missing_evidence" });
    for (const changed of [
      { ...evidence, calculation_result: 13 },
      { ...evidence, normalized_unit: "LF" },
      { ...evidence, calculation_inputs: { ...evidence.calculation_inputs, parsed_quantity: "13" } },
      { ...evidence, source_quote: "Door schedule Qty 13" },
      { ...evidence, source_locator: "PDF p.4 col 'Qty'" },
      { ...evidence, calculation_checksum: "0".repeat(64) },
    ]) {
      assert.equal(validateExtractorQuantityCandidate(changed, 12, "EA").status, "blocked");
    }
  });

  it("recomputes the declared extractor formula even when a forged checksum is internally valid", () => {
    const forged = {
      ...evidence,
      calculation_inputs: { ...evidence.calculation_inputs, parsed_quantity: "13" },
      calculation_checksum: "",
    };
    forged.calculation_checksum = computeExtractorEvidenceChecksum(forged);

    assert.deepEqual(validateExtractorQuantityCandidate(forged, 12, "EA"), {
      status: "blocked",
      reason: "calculation_mismatch",
    });
    assert.equal(validateExtractorQuantityCandidate({ ...evidence, formula_version: "made-up-v1" }, 12, "EA").status, "blocked");
  });

  it("uses the extractor's three-decimal storage rounding when recomputing formulas", () => {
    const rounded = {
      measurement_class: "length" as const,
      source_kind: "geometry" as const,
      original_unit: "LF",
      normalized_unit: "LF",
      formula_version: "geometry-length-v1",
      calculation_inputs: { raw_length: "0.00056", conversion_factor: "1" },
      calculation_result: 0.001,
      source_quote: "Measured raw length 0.00056 LF",
      source_locator: "DXF layer PIPE",
      calculation_checksum: "",
    };
    rounded.calculation_checksum = computeExtractorEvidenceChecksum(rounded);

    assert.equal(validateExtractorQuantityCandidate(rounded, 0.001, "LF").status, "validated");
  });
});
