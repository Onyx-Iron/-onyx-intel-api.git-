/**
 * Pure spatial snap algorithm — shared by the main thread (tests, collectSnapPoints)
 * and the snap Web Worker (mousemove hot path).
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
