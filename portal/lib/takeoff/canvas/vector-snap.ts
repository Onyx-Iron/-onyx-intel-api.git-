/**
 * Magnetic snap: pull the cursor onto the nearest CAD/PDF vector vertex
 * when it is within `thresholdPixels` of that vertex (screen space).
 */

export interface VectorPoint {
  x: number;
  y: number;
}

export interface SnapResult {
  snapped: boolean;
  point: VectorPoint;
  distance: number;
}

export const DEFAULT_SNAP_THRESHOLD_PX = 12;

/**
 * Find the nearest vector vertex to `cursor` within `thresholdPixels`.
 * When nothing is close enough, returns the original cursor (snapped: false).
 */
export function getNearestVectorPoint(
  cursor: VectorPoint,
  vectorPoints: ReadonlyArray<VectorPoint>,
  thresholdPixels: number = DEFAULT_SNAP_THRESHOLD_PX,
): SnapResult {
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    return { snapped: false, point: { x: cursor.x, y: cursor.y }, distance: Infinity };
  }
  if (vectorPoints.length === 0 || thresholdPixels < 0) {
    return { snapped: false, point: { x: cursor.x, y: cursor.y }, distance: Infinity };
  }

  let best: VectorPoint | null = null;
  let bestDist = thresholdPixels;

  for (const candidate of vectorPoints) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
    const distance = Math.hypot(candidate.x - cursor.x, candidate.y - cursor.y);
    if (distance <= bestDist) {
      bestDist = distance;
      best = candidate;
    }
  }

  if (!best) {
    return { snapped: false, point: { x: cursor.x, y: cursor.y }, distance: Infinity };
  }

  return { snapped: true, point: { x: best.x, y: best.y }, distance: bestDist };
}

/**
 * Flatten polyline / point vectors into unique screen-space snap targets.
 * Coordinates are rounded to 0.1px so near-duplicate vertices collapse.
 */
export function collectSnapPoints(
  vectors: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number] | VectorPoint> }>,
): VectorPoint[] {
  const seen = new Set<string>();
  const out: VectorPoint[] = [];

  for (const vector of vectors) {
    for (const raw of vector.points) {
      const x = "x" in raw ? raw.x : raw[0];
      const y = "y" in raw ? raw.y : raw[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const key = `${Math.round(x * 10)},${Math.round(y * 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y });
    }
  }

  return out;
}
