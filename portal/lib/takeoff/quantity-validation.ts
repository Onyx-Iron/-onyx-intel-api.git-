import { createHash } from "node:crypto";
import {
  calculateCount,
  calculateLinearLength,
  calculatePolygonArea,
} from "./canvas/quantity";

interface Point { x: number; y: number }
export type MeasurementClass = "length" | "area" | "count";

export interface QuantityCandidateInput {
  sourceChecksum: string;
  authoritativeChecksum: string;
  manifestVersion: number;
  authoritativeManifestVersion: number;
  coordinateSpace: "page_space" | "legacy_pixel" | string;
  scaleVerified: boolean;
  pageSpaceScaleFactor?: number | null;
  measurementClass: MeasurementClass;
  unit: string;
  points: Point[];
  submittedQuantity: number;
}

type BlockReason = "missing_unit" | "stale_revision" | "invalid_coordinate_space" | "scale_unverified" | "invalid_geometry" | "quantity_mismatch" | "invalid_quantity";
export type QuantityValidationResult =
  | { status: "blocked"; reason: BlockReason }
  | { status: "validated"; quantity: number; formulaVersion: `${MeasurementClass}-v1`; calculationChecksum: string };

const UNITS: Record<MeasurementClass, ReadonlySet<string>> = {
  length: new Set(["LF", "FT", "IN", "YD", "M", "MM"]),
  area: new Set(["SF", "SQFT", "SY", "M2", "SQM"]),
  count: new Set(["EA", "EACH", "COUNT"]),
};

export function validateQuantityCandidate(input: QuantityCandidateInput): QuantityValidationResult {
  const unit = input.unit.trim().toUpperCase();
  if (!unit || !UNITS[input.measurementClass].has(unit)) return { status: "blocked", reason: "missing_unit" };
  if (input.manifestVersion !== input.authoritativeManifestVersion || input.sourceChecksum !== input.authoritativeChecksum) {
    return { status: "blocked", reason: "stale_revision" };
  }
  if (input.coordinateSpace !== "page_space") return { status: "blocked", reason: "invalid_coordinate_space" };
  if (!Number.isFinite(input.submittedQuantity) || input.submittedQuantity < 0) return { status: "blocked", reason: "invalid_quantity" };
  const scale = input.pageSpaceScaleFactor ?? 0;
  if (input.measurementClass !== "count" && (!input.scaleVerified || !Number.isFinite(scale) || scale <= 0)) {
    return { status: "blocked", reason: "scale_unverified" };
  }
  if (input.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return { status: "blocked", reason: "invalid_geometry" };
  }

  const quantity = input.measurementClass === "length"
    ? calculateLinearLength(input.points, scale)
    : input.measurementClass === "area"
      ? calculatePolygonArea(input.points, scale)
      : calculateCount(input.points);
  if (quantity <= 0) return { status: "blocked", reason: "invalid_geometry" };
  const tolerance = Math.max(1e-6, Math.abs(quantity) * 0.001);
  if (Math.abs(quantity - input.submittedQuantity) > tolerance) return { status: "blocked", reason: "quantity_mismatch" };

  const formulaVersion = `${input.measurementClass}-v1` as const;
  const calculationChecksum = createHash("sha256").update(JSON.stringify({
    formulaVersion, points: input.points, scale: input.measurementClass === "count" ? null : scale, unit, quantity,
  })).digest("hex");
  return { status: "validated", quantity, formulaVersion, calculationChecksum };
}

export type TextQuantitySource = "schedule" | "note" | "callout" | "text";

export interface TextQuantityCandidateInput {
  sourceChecksum: string;
  authoritativeChecksum: string;
  manifestVersion: number;
  authoritativeManifestVersion: number;
  unit: string;
  submittedQuantity: number;
  rawText: string;
  sourceKind: TextQuantitySource;
  pageNumber: number;
}

type TextBlockReason = "missing_unit" | "stale_revision" | "invalid_quantity" | "missing_source_quote" | "quantity_not_quoted" | "unsupported_source" | "invalid_page";
export type TextQuantityValidationResult =
  | { status: "blocked"; reason: TextBlockReason }
  | { status: "validated"; quantity: number; formulaVersion: "source-text-v1"; calculationChecksum: string };

const TEXT_SOURCES = new Set<TextQuantitySource>(["schedule", "note", "callout", "text"]);

/**
 * Validates quantities explicitly printed on a source sheet. This is not a
 * geometry measurement: the exact source quote is mandatory and must contain
 * the submitted numeric value. It therefore remains independently auditable
 * without pretending that vision supplied a verified drawing scale.
 */
export function validateTextQuantityCandidate(input: TextQuantityCandidateInput): TextQuantityValidationResult {
  const unit = input.unit.trim().toUpperCase();
  if (!unit) return { status: "blocked", reason: "missing_unit" };
  if (input.manifestVersion !== input.authoritativeManifestVersion || input.sourceChecksum !== input.authoritativeChecksum) {
    return { status: "blocked", reason: "stale_revision" };
  }
  if (!Number.isFinite(input.submittedQuantity) || input.submittedQuantity < 0) return { status: "blocked", reason: "invalid_quantity" };
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) return { status: "blocked", reason: "invalid_page" };
  if (!TEXT_SOURCES.has(input.sourceKind)) return { status: "blocked", reason: "unsupported_source" };
  const rawText = input.rawText.trim();
  if (!rawText) return { status: "blocked", reason: "missing_source_quote" };

  const quotedNumbers = [...rawText.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replaceAll(",", "")))
    .filter(Number.isFinite);
  const tolerance = Math.max(1e-6, Math.abs(input.submittedQuantity) * 0.001);
  if (!quotedNumbers.some((value) => Math.abs(value - input.submittedQuantity) <= tolerance)) {
    return { status: "blocked", reason: "quantity_not_quoted" };
  }

  const formulaVersion = "source-text-v1" as const;
  const calculationChecksum = createHash("sha256").update(JSON.stringify({
    formulaVersion,
    sourceChecksum: input.sourceChecksum,
    pageNumber: input.pageNumber,
    sourceKind: input.sourceKind,
    rawText,
    quantity: input.submittedQuantity,
    unit,
  })).digest("hex");
  return { status: "validated", quantity: input.submittedQuantity, formulaVersion, calculationChecksum };
}

export type ExtractorMeasurementClass = MeasurementClass | "volume" | "weight" | "other";
export type ExtractorSourceKind = "schedule" | "geometry" | "model" | "spreadsheet";

export interface ExtractorQuantityEvidence {
  measurement_class: ExtractorMeasurementClass;
  source_kind: ExtractorSourceKind;
  original_unit: string | null;
  normalized_unit: string;
  formula_version: string;
  calculation_inputs: Record<string, string>;
  calculation_result: number;
  source_quote: string;
  source_locator: string | null;
  calculation_checksum: string;
}

type ExtractorBlockReason = "missing_evidence" | "invalid_evidence" | "unsupported_formula" | "calculation_mismatch" | "quantity_mismatch" | "unit_mismatch" | "checksum_mismatch";
export type ExtractorQuantityValidationResult =
  | { status: "blocked"; reason: ExtractorBlockReason }
  | { status: "validated"; quantity: number; formulaVersion: string; calculationChecksum: string };

function canonicalDecimal(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Object.is(value, -0) || value === 0) return "0";
  const rendered = String(value);
  if (!/[eE]/.test(rendered)) return rendered.includes(".") ? rendered.replace(/0+$/, "").replace(/\.$/, "") : rendered;

  const match = rendered.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return rendered;
  const [, sign, integer, fraction = "", exponentText] = match;
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + Number(exponentText);
  const plain = decimalIndex <= 0
    ? `0.${"0".repeat(-decimalIndex)}${digits}`
    : decimalIndex >= digits.length
      ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return `${sign}${plain}`.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function computeExtractorEvidenceChecksum(evidence: Omit<ExtractorQuantityEvidence, "calculation_checksum">): string {
  const normalizedInputs = Object.fromEntries(
    Object.entries(evidence.calculation_inputs).sort(([left], [right]) => left.localeCompare(right)),
  );
  const preimage = [
    evidence.formula_version,
    evidence.source_kind,
    evidence.measurement_class,
    evidence.original_unit?.trim() ?? "",
    evidence.normalized_unit.trim().toUpperCase(),
    evidence.source_quote.trim(),
    evidence.source_locator?.trim() ?? "",
    JSON.stringify(normalizedInputs),
    canonicalDecimal(evidence.calculation_result),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}

function quotedNumbers(rawText: string): number[] {
  return [...rawText.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replaceAll(",", "")))
    .filter(Number.isFinite);
}

function recomputeExtractorQuantity(evidence: ExtractorQuantityEvidence): number | null {
  const numericInput = (key: string): number | null => {
    const value = Number(evidence.calculation_inputs[key]);
    return Number.isFinite(value) ? value : null;
  };
  switch (evidence.formula_version) {
    case "source-text-v1": {
      if (evidence.source_kind !== "schedule") return null;
      const parsed = numericInput("parsed_quantity");
      if (parsed == null || !quotedNumbers(evidence.source_quote).some((value) => Math.abs(value - parsed) <= Math.max(1e-6, Math.abs(parsed) * 0.001))) return Number.NaN;
      return parsed;
    }
    case "spreadsheet-cell-v1": {
      if (evidence.source_kind !== "spreadsheet") return null;
      const parsed = numericInput("parsed_quantity");
      if (parsed == null || !quotedNumbers(evidence.source_quote).some((value) => Math.abs(value - parsed) <= Math.max(1e-6, Math.abs(parsed) * 0.001))) return Number.NaN;
      return parsed;
    }
    case "schedule-default-count-v1":
      return (evidence.source_kind === "schedule" || evidence.source_kind === "spreadsheet")
        && evidence.measurement_class === "count" && numericInput("default_count") === 1 ? 1 : null;
    case "geometry-length-v1": {
      if (evidence.source_kind !== "geometry" || evidence.measurement_class !== "length") return null;
      const raw = numericInput("raw_length");
      const factor = numericInput("conversion_factor");
      return raw == null || factor == null ? null : raw * factor;
    }
    case "geometry-area-v1": {
      if (evidence.source_kind !== "geometry" || evidence.measurement_class !== "area") return null;
      const raw = numericInput("raw_area");
      const factor = numericInput("conversion_factor_squared");
      return raw == null || factor == null ? null : raw * factor;
    }
    case "geometry-count-v1":
      return evidence.source_kind === "geometry" && evidence.measurement_class === "count" ? numericInput("block_count") : null;
    case "model-base-quantity-v1":
      return evidence.source_kind === "model" ? numericInput("model_quantity") : null;
    case "model-instance-count-v1":
      return evidence.source_kind === "model" && evidence.measurement_class === "count" ? numericInput("instance_count") : null;
    default:
      return null;
  }
}

function roundExtractorQuantity(value: number): number {
  return Math.floor(value * 1000 + 0.5) / 1000;
}

/** Verify deterministic extractor evidence before a row can enter approval. */
export function validateExtractorQuantityCandidate(
  evidence: ExtractorQuantityEvidence | null | undefined,
  submittedQuantity: number,
  submittedUnit: string,
): ExtractorQuantityValidationResult {
  if (!evidence) return { status: "blocked", reason: "missing_evidence" };
  if (
    !evidence.formula_version?.trim()
    || !evidence.source_quote?.trim()
    || !evidence.source_locator?.trim()
    || !evidence.normalized_unit?.trim()
    || !evidence.calculation_inputs
    || typeof evidence.calculation_inputs !== "object"
    || Object.keys(evidence.calculation_inputs).length === 0
    || Object.values(evidence.calculation_inputs).some((value) => typeof value !== "string")
    || !Number.isFinite(evidence.calculation_result)
    || evidence.calculation_result < 0
    || !/^[a-f0-9]{64}$/.test(evidence.calculation_checksum)
  ) return { status: "blocked", reason: "invalid_evidence" };

  const recomputedQuantity = recomputeExtractorQuantity(evidence);
  if (recomputedQuantity == null) return { status: "blocked", reason: "unsupported_formula" };
  const recomputedStoredQuantity = Number.isFinite(recomputedQuantity) ? roundExtractorQuantity(recomputedQuantity) : recomputedQuantity;
  const calculationTolerance = Math.max(1e-6, Math.abs(evidence.calculation_result) * 0.001);
  if (!Number.isFinite(recomputedStoredQuantity) || Math.abs(recomputedStoredQuantity - evidence.calculation_result) > calculationTolerance) {
    return { status: "blocked", reason: "calculation_mismatch" };
  }

  const normalizedUnit = submittedUnit.trim().toUpperCase();
  if (!normalizedUnit || normalizedUnit !== evidence.normalized_unit.trim().toUpperCase()) {
    return { status: "blocked", reason: "unit_mismatch" };
  }
  const tolerance = Math.max(1e-6, Math.abs(submittedQuantity) * 0.001);
  if (!Number.isFinite(submittedQuantity) || Math.abs(evidence.calculation_result - submittedQuantity) > tolerance) {
    return { status: "blocked", reason: "quantity_mismatch" };
  }

  const { calculation_checksum: suppliedChecksum, ...checksumEvidence } = evidence;
  if (computeExtractorEvidenceChecksum(checksumEvidence) !== suppliedChecksum) {
    return { status: "blocked", reason: "checksum_mismatch" };
  }
  return {
    status: "validated",
    quantity: evidence.calculation_result,
    formulaVersion: evidence.formula_version,
    calculationChecksum: suppliedChecksum,
  };
}
