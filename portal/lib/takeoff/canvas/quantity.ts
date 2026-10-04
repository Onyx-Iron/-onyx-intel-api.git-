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

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function segmentsProperlyIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** A bowtie cancels through the shoelace formula. That area is not stored. */
export function polygonSelfIntersects(points: Point[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1) continue;
      if (i === 0 && j === n - 1) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Shoelace-formula polygon area, in real-world units squared. */
export function calculatePolygonArea(points: Point[], pageSpaceScaleFactor: number, opts?: WasteAndMultiplier): number {
  if (points.length < 3) return 0;
  if (polygonSelfIntersects(points)) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  const pageSpaceArea = Math.abs(sum) / 2;
  const realWorldArea = pageSpaceArea * pageSpaceScaleFactor * pageSpaceScaleFactor;
  return applyWasteAndMultiplier(realWorldArea, opts);
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

export interface QuantityGeometry {
  measure?: string | null;
  thickness?: number | null;
  width?: number | null;
  depth?: number | null;
  slope_pct?: number | null;
  slopePct?: number | null;
}

function finitePositive(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readQuantityGeometry(measureOrGeometry?: string | null | QuantityGeometry): QuantityGeometry {
  if (typeof measureOrGeometry === "string" || measureOrGeometry == null) {
    return { measure: measureOrGeometry ?? null };
  }
  return measureOrGeometry;
}

/**
 * Server and canvas share this switch so a perimeter cannot be priced as an area.
 * A self-crossing polygon returns null: the shoelace sum would cancel and look like a real area.
 * Thickness, width, depth, and slope on the geometry are part of the stored quantity.
 */
export function quantityForMeasurement(
  takeoffType: string,
  points: Point[],
  pageSpaceScaleFactor: number,
  measureOrGeometry?: string | null | QuantityGeometry,
): number | null {
  const geometry = readQuantityGeometry(measureOrGeometry);
  const measure = geometry.measure ?? null;
  const closed = takeoffType === "area" || takeoffType === "perimeter" || measure === "perimeter";
  if (closed && polygonSelfIntersects(points)) return null;
  if (takeoffType === "count") return calculateCount(points);
  if (takeoffType === "perimeter" || measure === "perimeter") return calculatePerimeter(points, pageSpaceScaleFactor);
  const thickness = finitePositive(geometry.thickness);
  const width = finitePositive(geometry.width);
  const depth = finitePositive(geometry.depth);
  const slope = geometry.slope_pct ?? geometry.slopePct;
  const slopePct = typeof slope === "number" && Number.isFinite(slope) ? slope : null;
  if (takeoffType === "area") {
    const thick = thickness ?? depth;
    if (thick != null) return calculateAreaVolume(points, pageSpaceScaleFactor, thick);
    return calculatePolygonArea(points, pageSpaceScaleFactor);
  }
  if (width != null && depth != null) return calculateBoxVolume(points, pageSpaceScaleFactor, width, depth);
  if (slopePct != null && slopePct !== 0) return calculateSlopeAdjustedLength(points, pageSpaceScaleFactor, slopePct);
  return calculateLinearLength(points, pageSpaceScaleFactor);
}

/** An unscaled sheet has no calculated quantity. A verified sheet stores the formula result. */
export function calculatedQuantityForSave(verified: boolean, serverQuantity: number | null): number | null {
  if (!verified) return null;
  return serverQuantity;
}

export interface ScaleRegionInput {
  id: string;
  polygon: Point[];
  pageSpaceScaleFactor: number | null;
  verified: boolean;
}

export interface ScaleFactorResult {
  factor: number | null;
  regionId: string | null;
  verified: boolean;
}

/** Vertex average. A line uses the same point the area formula would. */
export function measurementCentroid(points: Point[]): Point | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function polygonAreaAbs(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Even-odd ray cast. A self-crossing region does not contain a point. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3 || polygonSelfIntersects(polygon)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

/**
 * A verified region that contains the measurement centroid wins over the sheet scale.
 * An unverified region that contains the centroid produces no quantity.
 * Outside every region, the sheet factor applies when that sheet scale is verified.
 */
export function scaleFactorForPoints(
  points: Point[],
  regions: ScaleRegionInput[],
  sheetFactor: number | null,
  sheetVerified: boolean,
): ScaleFactorResult {
  const centroid = measurementCentroid(points);
  if (!centroid) return { factor: null, regionId: null, verified: false };
  const covering = regions.filter((region) => pointInPolygon(centroid, region.polygon));
  if (covering.length > 0) {
    const verified = covering
      .filter((region) => region.verified && region.pageSpaceScaleFactor != null && region.pageSpaceScaleFactor > 0)
      .sort((a, b) => polygonAreaAbs(a.polygon) - polygonAreaAbs(b.polygon));
    if (verified[0]) {
      return {
        factor: verified[0].pageSpaceScaleFactor,
        regionId: verified[0].id,
        verified: true,
      };
    }
    return { factor: null, regionId: covering[0].id, verified: false };
  }
  if (sheetVerified && sheetFactor != null && sheetFactor > 0) {
    return { factor: sheetFactor, regionId: null, verified: true };
  }
  return { factor: null, regionId: null, verified: false };
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
