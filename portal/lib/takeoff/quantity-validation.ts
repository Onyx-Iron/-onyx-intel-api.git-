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
