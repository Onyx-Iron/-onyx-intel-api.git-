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
 * Build a uniform 2D grid of sample positions covering [minX,maxX] x [minY,maxY].
 * Result is row-major: grid[row][col] where row maps to Y, col maps to X.
 */
export function buildGrid(
  bounds: Pick<Bounds, "minX" | "maxX" | "minY" | "maxY">,
  resolution: number
): Point2[][] {
  const res = Math.max(resolution, 0.0001);
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / res) + 1);
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / res) + 1);
  const grid: Point2[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Point2[] = [];
    const y = bounds.minY + r * res;
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + c * res;
      row.push({ x, y });
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Integrate a per-cell Δz grid into cut/fill/net volumes in cubic yards.
 * cellAreaSf is the square-foot area represented by one grid cell.
 * Convention: delta = proposed.z - existing.z.
 *   delta < 0 → cut  (existing > proposed → material removed)
 *   delta > 0 → fill (proposed > existing → material added)
 */
export function computeVolumes(deltaGrid: number[][], cellAreaSf: number): VolumeResult {
  let cutCf = 0;
  let fillCf = 0;
  for (let r = 0; r < deltaGrid.length; r++) {
    const row = deltaGrid[r];
    for (let c = 0; c < row.length; c++) {
      const d = row[c];
      if (!Number.isFinite(d)) continue;
      if (d < 0) cutCf += -d * cellAreaSf;
      else if (d > 0) fillCf += d * cellAreaSf;
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
