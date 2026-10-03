// Authoritative quantity-calculation layer (manual-takeoff-calibration-
// hardening milestone, STEP 6). Every formula here takes PAGE-SPACE geometry
// (see lib/takeoff/canvas/coordinates.ts) plus a page-space-relative
// calibration factor — never current-render pixels and never a raw
// render-scale-dependent ratio. This is what makes a calculated quantity
// invariant to zoom, pan, viewport size, device pixel ratio, and fit-width/
// fit-page mode: none of those change page-space coordinates or the
// calibration factor, so they cannot change the result.
//
// `pageSpaceScaleFactor` is real-world-units per page-space-unit — computed
// once at calibration time from two page-space points and a known
// real-world distance (see CALCULATION_RULES.md). This module is imported
// by both the client (for a live preview) and the server (for authoritative
// validation) — the server never trusts a browser-submitted quantity as-is.

import type { Point } from "./coordinates";

export const FORMULA_VERSION = "v1";

export interface WasteAndMultiplier {
  wasteFactorPct?: number;   // e.g. 10 for +10%
  multiplier?: number;       // e.g. 2 for "two of these per location"
}

function applyWasteAndMultiplier(raw: number, opts?: WasteAndMultiplier): number {
  const withMultiplier = raw * (opts?.multiplier ?? 1);
  const withWaste = withMultiplier * (1 + (opts?.wasteFactorPct ?? 0) / 100);
  return withWaste;
}

function pageSpaceLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Linear length of a single segment or a polyline, in real-world units. */
export function calculateLinearLength(points: Point[], pageSpaceScaleFactor: number, opts?: WasteAndMultiplier): number {
  if (points.length < 2) return 0;
  const realWorldLength = pageSpaceLength(points) * pageSpaceScaleFactor;
  return applyWasteAndMultiplier(realWorldLength, opts);
}

/** Alias — a polyline's length calculation is identical to linear length; kept as a distinct named export for clarity at call sites. */
export const calculatePolylineLength = calculateLinearLength;

/** Perimeter of a closed polygon (implicitly closes the last point back to the first). */
export function calculatePerimeter(points: Point[], pageSpaceScaleFactor: number, opts?: WasteAndMultiplier): number {
  if (points.length < 2) return 0;
  const closed = [...points, points[0]];
  const realWorldPerimeter = pageSpaceLength(closed) * pageSpaceScaleFactor;
  return applyWasteAndMultiplier(realWorldPerimeter, opts);
}

function rawPolygonArea(points: Point[], pageSpaceScaleFactor: number): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return (Math.abs(sum) / 2) * pageSpaceScaleFactor * pageSpaceScaleFactor;
}

/** Shoelace-formula polygon area, in real-world units squared. */
export function calculatePolygonArea(points: Point[], pageSpaceScaleFactor: number, opts?: WasteAndMultiplier): number {
  return applyWasteAndMultiplier(rawPolygonArea(points, pageSpaceScaleFactor), opts);
}

/** Outer area minus hole rings. With no holes this matches calculatePolygonArea. */
export function calculateNetPolygonArea(
  points: Point[],
  pageSpaceScaleFactor: number,
  holes: Point[][] = [],
  opts?: WasteAndMultiplier,
): number {
  const holeArea = holes.reduce((sum, hole) => sum + rawPolygonArea(hole, pageSpaceScaleFactor), 0);
  return applyWasteAndMultiplier(Math.max(0, rawPolygonArea(points, pageSpaceScaleFactor) - holeArea), opts);
}

/** Rectangle area from two opposite corners, in real-world units squared. */
export function calculateRectangleArea(a: Point, b: Point, pageSpaceScaleFactor: number, opts?: WasteAndMultiplier): number {
  const pageSpaceArea = Math.abs(b.x - a.x) * Math.abs(b.y - a.y);
  const realWorldArea = pageSpaceArea * pageSpaceScaleFactor * pageSpaceScaleFactor;
  return applyWasteAndMultiplier(realWorldArea, opts);
}

/** Circle area from a center point and a point on the circumference, in real-world units squared. */
export function calculateCircleArea(center: Point, edge: Point, pageSpaceScaleFactor: number, opts?: WasteAndMultiplier): number {
  const pageSpaceRadius = Math.hypot(edge.x - center.x, edge.y - center.y);
  const realWorldRadius = pageSpaceRadius * pageSpaceScaleFactor;
  const realWorldArea = Math.PI * realWorldRadius * realWorldRadius;
  return applyWasteAndMultiplier(realWorldArea, opts);
}

/** Count — always the number of placed points, independent of geometry/calibration entirely. */
export function calculateCount(points: Point[], opts?: WasteAndMultiplier): number {
  return applyWasteAndMultiplier(points.length, opts);
}

/** Area × thickness (e.g. slab volume), returned in cubic real-world units (thickness given in the same real-world unit as the area's linear unit, e.g. feet — convert inches beforehand). */
export function calculateAreaVolume(points: Point[], pageSpaceScaleFactor: number, thickness: number, opts?: WasteAndMultiplier): number {
  const area = calculatePolygonArea(points, pageSpaceScaleFactor);
  return applyWasteAndMultiplier(area * thickness, opts);
}

/** Length × width × depth (e.g. trench volume), all in real-world units already — width/depth are not page-space quantities (they come from measurement properties, not geometry), so no scale factor applies to them. */
export function calculateBoxVolume(lengthPoints: Point[], pageSpaceScaleFactor: number, width: number, depth: number, opts?: WasteAndMultiplier): number {
  const length = calculateLinearLength(lengthPoints, pageSpaceScaleFactor);
  return applyWasteAndMultiplier(length * width * depth, opts);
}

/**
 * Slope-adjusted length: page-space (plan-view) length combined with a rise
 * per run-unit percentage to get true (hypotenuse) length along the slope —
 * e.g. a 100 ft plan-view run at a 10% grade is 100.5 ft of actual pipe/pavement.
 */
export function calculateSlopeAdjustedLength(points: Point[], pageSpaceScaleFactor: number, slopePct: number, opts?: WasteAndMultiplier): number {
  const planLength = calculateLinearLength(points, pageSpaceScaleFactor);
  const rise = planLength * (slopePct / 100);
  const slopeLength = Math.hypot(planLength, rise);
  return applyWasteAndMultiplier(slopeLength, opts);
}

// ── Unit conversion ─────────────────────────────────────────────────────────
const LENGTH_TO_FEET: Record<string, number> = {
  ft: 1, feet: 1, lf: 1,
  in: 1 / 12, inch: 1 / 12, inches: 1 / 12,
  yd: 3, yard: 3, yards: 3,
  m: 3.280839895, meter: 3.280839895, meters: 3.280839895,
  cm: 0.03280839895, centimeter: 0.03280839895,
  mm: 0.003280839895, millimeter: 0.003280839895,
};

/** Converts a linear real-world quantity between supported units (case-insensitive). Throws on an unrecognized unit rather than silently guessing. */
export function convertLinearUnit(value: number, fromUnit: string, toUnit: string): number {
  const from = LENGTH_TO_FEET[fromUnit.toLowerCase()];
  const to = LENGTH_TO_FEET[toUnit.toLowerCase()];
  if (from === undefined) throw new Error(`convertLinearUnit: unrecognized source unit "${fromUnit}"`);
  if (to === undefined) throw new Error(`convertLinearUnit: unrecognized target unit "${toUnit}"`);
  return (value * from) / to;
}
