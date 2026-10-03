/**
 * Magnetic snap helpers for CAD/PDF vector vertices.
 * Hot-path nearest-point search runs in workers/snap.worker.ts.
 */

export {
  DEFAULT_SNAP_THRESHOLD_PX,
  getNearestVectorPoint,
  type SnapResult,
  type VectorPoint,
} from "./snap-algorithm";

/**
 * Flatten polyline / point vectors into unique screen-space snap targets.
 * Coordinates are rounded to 0.1px so near-duplicate vertices collapse.
 */
export function collectSnapPoints(
  vectors: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number] | { x: number; y: number }> }>,
): import("./snap-algorithm").VectorPoint[] {
  const seen = new Set<string>();
  const out: import("./snap-algorithm").VectorPoint[] = [];

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
