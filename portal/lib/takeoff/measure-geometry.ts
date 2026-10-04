/**
 * Page-space polylines and closed areas, quantified with the scale printed
 * on the same region of the sheet. Quantities use `quantity.ts`, so a second
 * render size cannot change them. Geometry with no printed scale is kept and
 * left unquantified.
 */

import type { Point } from "./canvas/coordinates";
import { calculateLinearLength, calculatePolygonArea } from "./canvas/quantity";
import { regionForPoint, type ScaleRegion } from "./stated-scale";

export interface PagePath {
  points: Point[];
  closed: boolean;
}

export interface MeasuredGeometry {
  points: Point[];
  closed: boolean;
  kind: "length" | "area";
  scaleText: string | null;
  pageSpaceScaleFactor: number | null;
  quantity: number | null;
  unit: "LF" | "SF" | null;
  originMethod: "stated_scale" | null;
  coordinateSystem: "page_space";
}

export interface RepeatedCount {
  quantity: number;
  unit: "EA";
  originMethod: "stated_scale";
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Open paths become length. Closed paths become area. There is no vector-count
 * ceiling: a drawing page is the measurement input.
 */
export function measurePageGeometry(paths: PagePath[], regions: ScaleRegion[]): MeasuredGeometry[] {
  const rows: MeasuredGeometry[] = [];
  for (const path of paths) {
    if (path.points.length < 2) continue;
    const region = regionForPoint(centroid(path.points), regions);
    const factor = region?.pageSpaceScaleFactor ?? null;
    const closed = path.closed && path.points.length >= 3;
    if (closed) {
      rows.push({
        points: path.points,
        closed: true,
        kind: "area",
        scaleText: region?.scaleText ?? null,
        pageSpaceScaleFactor: factor,
        quantity: factor != null ? calculatePolygonArea(path.points, factor) : null,
        unit: factor != null ? "SF" : null,
        originMethod: factor != null ? "stated_scale" : null,
        coordinateSystem: "page_space",
      });
      continue;
    }
    if (path.points.length < 2) continue;
    rows.push({
      points: path.points,
      closed: false,
      kind: "length",
      scaleText: region?.scaleText ?? null,
      pageSpaceScaleFactor: factor,
      quantity: factor != null ? calculateLinearLength(path.points, factor) : null,
      unit: factor != null ? "LF" : null,
      originMethod: factor != null ? "stated_scale" : null,
      coordinateSystem: "page_space",
    });
  }
  return rows;
}

/**
 * A count is a repeated mark only. One isolated point is not given a quantity of 1.
 */
export function countRepeatedMarks(points: Point[]): RepeatedCount | null {
  const buckets = new Map<string, number>();
  for (const point of points) {
    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let repeated = 0;
  for (const count of buckets.values()) {
    if (count >= 2) repeated += count;
  }
  if (repeated < 2) return null;
  return { quantity: repeated, unit: "EA", originMethod: "stated_scale" };
}

/** Measurement never calls a model host, with or without an API key. */
export function measurementRequestsModel(): boolean {
  return false;
}
