/**
 * Pure math for the manual takeoff tool — calibration + measurement.
 * No DOM dependencies; safe to import server-side too.
 */

export interface Point {
  x: number;
  y: number;
}

export interface PageDimensions {
  width: number;
  height: number;
}

/** px-per-unit ratio between two clicked points on the PDF page. */
export function calibrateFromTwoPoints(
  p1: Point,
  p2: Point,
  knownDistance: number,
  pageDims: PageDimensions,
): number {
  if (knownDistance <= 0) return 0;
  const dx = (p2.x - p1.x) * pageDims.width;
  const dy = (p2.y - p1.y) * pageDims.height;
  const pixelDistance = Math.sqrt(dx * dx + dy * dy);
  return pixelDistance / knownDistance;
}

/** Sum of euclidean segment lengths along a polyline. */
export function computeLength(coords: Point[], scale: number, pageDims: PageDimensions): number {
  if (coords.length < 2 || scale <= 0) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i].x - coords[i - 1].x) * pageDims.width;
    const dy = (coords[i].y - coords[i - 1].y) * pageDims.height;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total / scale;
}

/** Shoelace area for a closed polygon. */
export function computeArea(coords: Point[], scale: number, pageDims: PageDimensions): number {
  if (coords.length < 3 || scale <= 0) return 0;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i].x * pageDims.width * coords[j].y * pageDims.height;
    area -= coords[j].x * pageDims.width * coords[i].y * pageDims.height;
  }
  return Math.abs(area / 2) / (scale * scale);
}

export function computeCount(coords: Point[]): number {
  return coords.length;
}

export function unitFor(type: "length" | "area" | "count" | "angle"): string {
  return { length: "ft", area: "sf", count: "count", angle: "deg" }[type];
}
