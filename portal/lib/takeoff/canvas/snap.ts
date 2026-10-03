// Magnetic snap for the sheet SVG. Endpoints are the vertices already
// extracted from the page, projected with the same fit the CAD overlay uses
// so a click lands on the point the user sees.

export interface SnapPoint {
  x: number;
  y: number;
}

export interface VectorPolyline {
  points: Array<[number, number]>;
}

export const SNAP_TOLERANCE_PX = 12;
const PAD_PX = 20;

export interface VectorCanvasFrame {
  minX: number;
  minY: number;
  scale: number;
  pad: number;
  canvasH: number;
}

export function vectorCanvasFrame(
  vectors: VectorPolyline[],
  canvas: { w: number; h: number },
): VectorCanvasFrame | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vector of vectors) {
    for (const [x, y] of vector.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const wSpan = Math.max(1e-6, maxX - minX);
  const hSpan = Math.max(1e-6, maxY - minY);
  const sx = (canvas.w - PAD_PX * 2) / wSpan;
  const sy = (canvas.h - PAD_PX * 2) / hSpan;
  return {
    minX,
    minY,
    scale: Math.min(sx, sy),
    pad: PAD_PX,
    canvasH: canvas.h,
  };
}

export function projectToCanvas(x: number, y: number, frame: VectorCanvasFrame): SnapPoint {
  return {
    x: frame.pad + (x - frame.minX) * frame.scale,
    y: frame.canvasH - frame.pad - (y - frame.minY) * frame.scale,
  };
}

/** Inverse of projectToCanvas — screen pixel → drawing/world units. */
export function unprojectFromCanvas(x: number, y: number, frame: VectorCanvasFrame): SnapPoint {
  const scale = frame.scale || 1;
  return {
    x: frame.minX + (x - frame.pad) / scale,
    y: frame.minY + (frame.canvasH - frame.pad - y) / scale,
  };
}

/**
 * Map a screen-space view rectangle into world units for culling before
 * projection. Y is flipped the same way projectToCanvas flips it, so the
 * returned box keeps minY ≤ maxY in world space.
 */
export function screenViewToWorld(
  view: { minX: number; minY: number; maxX: number; maxY: number },
  frame: VectorCanvasFrame,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const a = unprojectFromCanvas(view.minX, view.minY, frame);
  const b = unprojectFromCanvas(view.maxX, view.maxY, frame);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function canvasEndpoints(vectors: VectorPolyline[], canvas: { w: number; h: number }): SnapPoint[] {
  const frame = vectorCanvasFrame(vectors, canvas);
  if (!frame) return [];
  const seen = new Set<string>();
  const endpoints: SnapPoint[] = [];
  for (const vector of vectors) {
    for (const [x, y] of vector.points) {
      const projected = projectToCanvas(x, y, frame);
      const key = `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      endpoints.push(projected);
    }
  }
  return endpoints;
}

export function nearestEndpoint(
  click: SnapPoint,
  endpoints: SnapPoint[],
  tolerancePx = SNAP_TOLERANCE_PX,
): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bestDistance = tolerancePx;
  for (const endpoint of endpoints) {
    const distance = Math.hypot(endpoint.x - click.x, endpoint.y - click.y);
    if (distance <= bestDistance) {
      best = endpoint;
      bestDistance = distance;
    }
  }
  return best;
}
