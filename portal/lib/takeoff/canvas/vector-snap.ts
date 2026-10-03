/**
 * Magnetic vector snapping — finds the nearest CAD vector vertex within a
 * pixel threshold of the cursor during active drawing modes.
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

/**
 * Return the nearest vector vertex to `cursor` when within `thresholdPixels`,
 * otherwise return the raw cursor position with `snapped: false`.
 */
export function getNearestVectorPoint(
  cursor: VectorPoint,
  vectorPoints: VectorPoint[],
  thresholdPixels = 12,
): SnapResult {
  if (vectorPoints.length === 0) {
    return { snapped: false, point: cursor, distance: Infinity };
  }

  let best: VectorPoint | null = null;
  let bestDist = Infinity;

  for (const vp of vectorPoints) {
    const dx = cursor.x - vp.x;
    const dy = cursor.y - vp.y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = vp;
    }
  }

  if (best != null && bestDist <= thresholdPixels) {
    return { snapped: true, point: best, distance: bestDist };
  }

  return { snapped: false, point: cursor, distance: bestDist };
}

/** Flatten CAD vector polylines into screen-space vertex points for snapping. */
export function extractScreenVertices(
  vectors: Array<{ points: Array<[number, number]> }>,
  canvasSize: { w: number; h: number },
): VectorPoint[] {
  if (vectors.length === 0 || canvasSize.w <= 0 || canvasSize.h <= 0) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vectors) {
    for (const [x, y] of v.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return [];

  const wSpan = Math.max(1e-6, maxX - minX);
  const hSpan = Math.max(1e-6, maxY - minY);
  const pad = 20;
  const sx = (canvasSize.w - pad * 2) / wSpan;
  const sy = (canvasSize.h - pad * 2) / hSpan;
  const s = Math.min(sx, sy);

  const project = (x: number, y: number): VectorPoint => ({
    x: pad + (x - minX) * s,
    y: canvasSize.h - pad - (y - minY) * s,
  });

  const out: VectorPoint[] = [];
  for (const v of vectors) {
    for (const [x, y] of v.points) {
      out.push(project(x, y));
    }
  }
  return out;
}
