export interface TopoPoint {
  x: number;
  y: number;
}

export interface ContourLine {
  elevation: number;
  points: TopoPoint[];
}

export interface SpotElevation {
  x: number;
  y: number;
  elevation: number;
}

export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Contours and spots already on the sheet, in feet.
 * `feetPerPixel` is the sheet scale (real feet per current display pixel).
 */
export function topoToSurfacePoints(
  contours: ContourLine[],
  spots: SpotElevation[],
  feetPerPixel: number,
): SurfacePoint[] {
  const points: SurfacePoint[] = [];
  for (const contour of contours) {
    for (const point of contour.points) {
      points.push({ x: point.x * feetPerPixel, y: point.y * feetPerPixel, z: contour.elevation });
    }
  }
  for (const spot of spots) {
    points.push({ x: spot.x * feetPerPixel, y: spot.y * feetPerPixel, z: spot.elevation });
  }
  return points;
}
