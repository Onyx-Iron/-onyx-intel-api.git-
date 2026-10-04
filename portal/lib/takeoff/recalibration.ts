import { quantityForMeasurement, type QuantityGeometry } from "./canvas/quantity.ts";

export interface RecalibrationMeasurement {
  id: string;
  label?: string | null;
  takeoff_type: string;
  quantity: number;
  unit?: string | null;
}

export interface RecalibrationPreviewLine {
  id: string;
  label: string;
  takeoff_type: string;
  unit: string | null;
  before: number;
  after: number;
  /** False when the old scale cannot recompute this quantity. */
  recomputed: boolean;
}

/**
 * Scale draft measurements from an old page-space factor to a new one.
 * Area scales with the square of the ratio. Counts do not change.
 * A missing old factor does not invent a new quantity.
 */
export function previewRecalibration(
  items: RecalibrationMeasurement[],
  oldFactor: number | null,
  newFactor: number,
): RecalibrationPreviewLine[] {
  const canScale = oldFactor != null && oldFactor > 0 && Number.isFinite(newFactor) && newFactor > 0;
  const ratio = canScale ? newFactor / (oldFactor as number) : 1;
  return items.map((item) => {
    let after = item.quantity;
    let recomputed = false;
    const linear = item.takeoff_type === "length" || item.takeoff_type === "perimeter" || item.takeoff_type === "perim";
    if (canScale && linear) {
      after = item.quantity * ratio;
      recomputed = true;
    } else if (canScale && item.takeoff_type === "area") {
      after = item.quantity * ratio * ratio;
      recomputed = true;
    }
    return {
      id: item.id,
      label: item.label?.trim() || item.takeoff_type,
      takeoff_type: item.takeoff_type,
      unit: item.unit ?? null,
      before: item.quantity,
      after,
      recomputed,
    };
  });
}

export function recalibrationNeedsConfirm(lines: RecalibrationPreviewLine[]): boolean {
  return lines.some((line) => line.recomputed && Math.abs(line.after - line.before) > 1e-6);
}

export interface PageSpaceMeasurement {
  id: string;
  takeoff_type: string;
  quantity: number;
  geometry?: {
    points?: Array<{ x: number; y: number }>;
    coordinate_space?: string | null;
    measure?: string | null;
    thickness?: number | null;
    width?: number | null;
    depth?: number | null;
    slope_pct?: number | null;
    slopePct?: number | null;
  } | null;
}

export interface RecomputedPageQuantity {
  id: string;
  before: number;
  /** Null when the polygon crosses itself and must not be priced. */
  after: number | null;
  recomputed: boolean;
}

/**
 * First calibration has no previous factor, and the stored quantity is the
 * pixel length the canvas used when scale defaulted to 1. Recompute from
 * page-space points so that number is not later priced as feet.
 */
export function recomputePageSpaceQuantities(
  items: PageSpaceMeasurement[],
  pageSpaceScaleFactor: number,
): RecomputedPageQuantity[] {
  return items.map((item) => {
    const geometry = item.geometry;
    const points = geometry?.points;
    const pageSpace = geometry?.coordinate_space === "page_space"
      && Array.isArray(points)
      && points.length > 0
      && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!pageSpace || !Number.isFinite(pageSpaceScaleFactor) || pageSpaceScaleFactor <= 0) {
      return { id: item.id, before: item.quantity, after: item.quantity, recomputed: false };
    }
    const measure: QuantityGeometry = {
      measure: geometry?.measure ?? null,
      thickness: geometry?.thickness ?? null,
      width: geometry?.width ?? null,
      depth: geometry?.depth ?? null,
      slope_pct: geometry?.slope_pct ?? geometry?.slopePct ?? null,
    };
    const after = quantityForMeasurement(item.takeoff_type, points, pageSpaceScaleFactor, measure);
    if (after == null || !Number.isFinite(after)) {
      return { id: item.id, before: item.quantity, after: null, recomputed: false };
    }
    return {
      id: item.id,
      before: item.quantity,
      after,
      recomputed: Math.abs(after - item.quantity) > 1e-6,
    };
  });
}
