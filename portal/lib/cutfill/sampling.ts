// Pure math for cut/fill surface interpolation and volume integration.

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface VolumeResult {
  cut: number;
  fill: number;
  net: number;
}

/**
 * Inverse-distance-weighted interpolation.
 * Returns NaN if input points array is empty.
 * If `at` coincides with an input point (within 1e-9), returns that z exactly.
 */
export function idwInterpolate(points: Point3[], at: Point2, power = 2): number {
  if (points.length === 0) return Number.NaN;
  let weightSum = 0;
  let valueSum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const dx = p.x - at.x;
    const dy = p.y - at.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-18) return p.z;
    const w = 1 / Math.pow(d2, power / 2);
    weightSum += w;
    valueSum += w * p.z;
  }
  return weightSum === 0 ? Number.NaN : valueSum / weightSum;
}

/**
 * Sample coordinates from `min` through `max`, stepping by `resolution`.
 * The last sample is `max` itself, so a partial closing interval stays inside
 * the overlap instead of adding another full cell past the far edge.
 */
export function sampleAxis(min: number, max: number, resolution: number): number[] {
  const res = Math.max(resolution, 0.0001);
  if (!(max > min)) return [min];
  const coords = [min];
  let cursor = min;
  while (cursor + res < max - 1e-9) {
    cursor += res;
    coords.push(cursor);
  }
  if (max - coords[coords.length - 1] > 1e-9) coords.push(max);
  return coords;
}

/**
 * Build a 2D grid of sample positions covering [minX,maxX] x [minY,maxY].
 * Samples are cell corners, not cell centers. Result is row-major:
 * grid[row][col] where row maps to Y, col maps to X.
 */
export function buildGrid(
  bounds: Pick<Bounds, "minX" | "maxX" | "minY" | "maxY">,
  resolution: number
): Point2[][] {
  const xs = sampleAxis(bounds.minX, bounds.maxX, resolution);
  const ys = sampleAxis(bounds.minY, bounds.maxY, resolution);
  return ys.map((y) => xs.map((x) => ({ x, y })));
}

/**
 * Integrate node Δz samples into cut/fill/net volumes in cubic yards.
 * `xs` / `ys` are the sample coordinates for each column and row. Each cell
 * is the rectangle between adjacent samples, and Δz is the mean of its four
 * corners — the same rule as the earthwork grid composite.
 * Convention: delta = proposed.z - existing.z.
 *   delta < 0 → cut  (existing > proposed → material removed)
 *   delta > 0 → fill (proposed > existing → material added)
 */
export function computeVolumes(deltaGrid: number[][], xs: number[], ys: number[]): VolumeResult {
  let cutCf = 0;
  let fillCf = 0;
  const rows = Math.min(deltaGrid.length, ys.length);
  const cols = Math.min(deltaGrid[0]?.length ?? 0, xs.length);
  for (let r = 0; r < rows - 1; r++) {
    const height = ys[r + 1] - ys[r];
    if (!(height > 0)) continue;
    const row = deltaGrid[r];
    const next = deltaGrid[r + 1];
    if (!row || !next) continue;
    for (let c = 0; c < cols - 1; c++) {
      const width = xs[c + 1] - xs[c];
      if (!(width > 0)) continue;
      const corners = [row[c], row[c + 1], next[c], next[c + 1]];
      if (corners.some((value) => !Number.isFinite(value))) continue;
      const delta = (corners[0] + corners[1] + corners[2] + corners[3]) / 4;
      const cubicFeet = delta * width * height;
      if (delta < 0) cutCf += -cubicFeet;
      else if (delta > 0) fillCf += cubicFeet;
    }
  }
  const cut = cutCf / 27;
  const fill = fillCf / 27;
  return { cut, fill, net: fill - cut };
}

export function computeBounds(points: Point3[]): Bounds {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * Parse CSV text into Point3 array. Accepts headers:
 *   x,y,z  OR  northing,easting,elevation (case-insensitive).
 * Skips blank/malformed rows.
 */
export function parseSurfaceCsv(csv: string): Point3[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headerCells = lines[0].split(",").map((h) => h.trim().toLowerCase());

  const idx = (names: string[]): number => {
    for (const n of names) {
      const i = headerCells.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  let xi = idx(["x", "easting"]);
  let yi = idx(["y", "northing"]);
  let zi = idx(["z", "elevation", "elev"]);

  let startRow = 1;
  // If no header recognized, assume the first row is data with x,y,z order.
  if (xi < 0 || yi < 0 || zi < 0) {
    xi = 0;
    yi = 1;
    zi = 2;
    startRow = 0;
  }

  const out: Point3[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const cells = lines[i].split(",");
    if (cells.length <= Math.max(xi, yi, zi)) continue;
    const x = parseFloat(cells[xi]);
    const y = parseFloat(cells[yi]);
    const z = parseFloat(cells[zi]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out.push({ x, y, z });
  }
  return out;
}
