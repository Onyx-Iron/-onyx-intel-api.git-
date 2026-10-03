import Delaunator from "delaunator";

export interface TinPoint {
  x: number;
  y: number;
  z: number;
}

export interface TinVolumes {
  cut_cy: number;
  fill_cy: number;
  net_cy: number;
  triangles: number;
  clipped: boolean;
  steepest_slope_pct: number;
  mean_slope_pct: number;
  low_points: TinPoint[];
}

export type Ring = Array<[number, number]>;

/**
 * Prism volumes on the existing-ground Delaunay mesh.
 * A boundary ring keeps a triangle only when its centroid is inside the ring.
 * That is coarser than the Python shapely clip, which intersects each triangle.
 */
export function cutFillTin(existing: TinPoint[], proposed: TinPoint[], boundary?: Ring | null): TinVolumes {
  if (existing.length < 3 || proposed.length < 3) {
    throw new Error("each surface needs at least 3 points");
  }
  const proposedZ = proposed.map((point) => point.z);
  const proposedIndex = Delaunator.from(proposed, (point) => point.x, (point) => point.y);
  const sampled = existing.map((point) => interpolate(proposed, proposedZ, proposedIndex.triangles, point.x, point.y));
  const delta = existing.map((point, index) => sampled[index] - point.z);
  const mesh = Delaunator.from(existing, (point) => point.x, (point) => point.y);

  let cut = 0;
  let fill = 0;
  const slopes: number[] = [];
  let steepest = 0;
  const limit = boundary && boundary.length >= 3 ? boundary : null;
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const a = mesh.triangles[i];
    const b = mesh.triangles[i + 1];
    const c = mesh.triangles[i + 2];
    const pa = existing[a];
    const pb = existing[b];
    const pc = existing[c];
    if (limit) {
      const centroid = { x: (pa.x + pb.x + pc.x) / 3, y: (pa.y + pb.y + pc.y) / 3 };
      if (!pointInRing(centroid, limit)) continue;
    }
    const area = Math.abs((pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x)) / 2;
    const change = ((delta[a] + delta[b] + delta[c]) / 3) * area;
    if (change < 0) cut += -change;
    else if (change > 0) fill += change;
    const slope = planeSlope(pa, pb, pc);
    slopes.push(slope * 100);
    if (slope * 100 > steepest) steepest = slope * 100;
  }

  return {
    cut_cy: cut / 27,
    fill_cy: fill / 27,
    net_cy: (fill - cut) / 27,
    triangles: mesh.triangles.length / 3,
    clipped: limit != null,
    steepest_slope_pct: steepest,
    mean_slope_pct: slopes.length ? slopes.reduce((sum, value) => sum + value, 0) / slopes.length : 0,
    low_points: localLows(existing, mesh.triangles, limit),
  };
}

function interpolate(points: TinPoint[], elevations: number[], triangles: ArrayLike<number>, x: number, y: number): number {
  for (let i = 0; i < triangles.length; i += 3) {
    const a = points[triangles[i]];
    const b = points[triangles[i + 1]];
    const c = points[triangles[i + 2]];
    const weights = barycentric(a, b, c, x, y);
    if (!weights) continue;
    return (
      weights.u * elevations[triangles[i]]
      + weights.v * elevations[triangles[i + 1]]
      + weights.w * elevations[triangles[i + 2]]
    );
  }
  let best = elevations[0];
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - x;
    const dy = points[i].y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = elevations[i];
    }
  }
  return best;
}

function barycentric(a: TinPoint, b: TinPoint, c: TinPoint, x: number, y: number): { u: number; v: number; w: number } | null {
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = x - a.x;
  const v2y = y - a.y;
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-12) return null;
  const v = (v2x * v1y - v1x * v2y) / den;
  const w = (v0x * v2y - v2x * v0y) / den;
  const u = 1 - v - w;
  if (u < -1e-8 || v < -1e-8 || w < -1e-8) return null;
  return { u, v, w };
}

function planeSlope(a: TinPoint, b: TinPoint, c: TinPoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  if (Math.abs(nz) < 1e-12) return 0;
  return Math.hypot(-nx / nz, -ny / nz);
}

function localLows(points: TinPoint[], triangles: ArrayLike<number>, boundary: Ring | null): TinPoint[] {
  const neighbors: number[][] = points.map(() => []);
  for (let i = 0; i < triangles.length; i += 3) {
    const ids = [triangles[i], triangles[i + 1], triangles[i + 2]];
    for (const id of ids) {
      for (const other of ids) {
        if (other !== id && !neighbors[id].includes(other)) neighbors[id].push(other);
      }
    }
  }
  const lows: TinPoint[] = [];
  points.forEach((point, index) => {
    const nbrs = neighbors[index];
    if (nbrs.length === 0 || !nbrs.every((other) => points[other].z > point.z + 1e-6)) return;
    if (boundary && !pointInRing(point, boundary)) return;
    lows.push(point);
  });
  return lows;
}

export function pointInRing(point: { x: number; y: number }, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
