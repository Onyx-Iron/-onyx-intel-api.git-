// Canvas coordinate transforms (professional-manual-takeoff milestone,
// STEP 3 / PERMANENT RULE 1-2).
//
// PROBLEM THIS FIXES: the pre-existing SheetCanvas.tsx stored every drawn
// point in CURRENT-RENDER canvas-pixel coordinates. The render scale itself
// is computed from the container's width at render time
// (`Math.min(2.5, Math.max(0.5, (containerWidth - 380) / viewport1.width))`),
// which varies with window size and device. A point stored as pixel (400, 300)
// means something different depending on what the container width happened
// to be at draw time — reopening the same sheet in a differently-sized
// window (or on a different device) would render previously-saved geometry
// in the WRONG location, and any future edit/vertex-move computed from that
// stale pixel geometry would be measuring against the wrong scale entirely.
// This directly violates "zoom does not change coordinates" / "window
// resizing does not change coordinates" (PERMANENT RULE 2, STEP 3).
//
// FIX: introduce "page space" — the PDF page's own coordinate system at
// pdf.js's base viewport (scale = 1), which is fixed per page regardless of
// window size, device pixel ratio, or zoom level. All persisted geometry is
// converted to page space before being sent to the server; screen pixels are
// only ever a rendering-time projection of page-space coordinates through
// whatever the CURRENT render scale happens to be.

export interface Point { x: number; y: number }

/** Converts a point in current-render screen-pixel space to stable page space. */
export function toPageSpace(screenPt: Point, renderScale: number): Point {
  if (renderScale <= 0 || !Number.isFinite(renderScale)) {
    throw new Error(`toPageSpace: renderScale must be a positive finite number, got ${renderScale}`);
  }
  return { x: screenPt.x / renderScale, y: screenPt.y / renderScale };
}

/** Converts a point in stable page space to the current render's screen-pixel space. */
export function toScreenSpace(pagePt: Point, renderScale: number): Point {
  if (renderScale <= 0 || !Number.isFinite(renderScale)) {
    throw new Error(`toScreenSpace: renderScale must be a positive finite number, got ${renderScale}`);
  }
  return { x: pagePt.x * renderScale, y: pagePt.y * renderScale };
}

export function pointsToPageSpace(points: Point[], renderScale: number): Point[] {
  return points.map((p) => toPageSpace(p, renderScale));
}

export function pointsToScreenSpace(points: Point[], renderScale: number): Point[] {
  return points.map((p) => toScreenSpace(p, renderScale));
}

/**
 * Move stored geometry by a screen-pixel drag. Page-space points are
 * projected, shifted, and stored again so a window resize does not change
 * the saved location. Legacy pixel points stay in that pixel space.
 */
export function translateStoredPoints(
  originalPoints: Point[],
  coordinateSpace: "page_space" | "legacy_pixel",
  dx: number,
  dy: number,
  renderScale: number,
): Point[] {
  const display = coordinateSpace === "page_space"
    ? pointsToScreenSpace(originalPoints, renderScale)
    : originalPoints;
  const moved = display.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return coordinateSpace === "page_space" ? pointsToPageSpace(moved, renderScale) : moved;
}

/** True when two polylines are the same stored geometry, including point order. */
export function samePoints(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
}

/**
 * Converts client (mouse-event) coordinates to page space in one step,
 * given the SVG element's bounding rect and the current render size —
 * combines the DPI/viewport-rect normalization pdf.js rendering requires
 * with the page-space projection above, so callers never touch raw client
 * coordinates without going through this.
 */
export function clientToPageSpace(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  renderSize: { w: number; h: number },
  renderScale: number,
): Point {
  const screenPt: Point = {
    x: ((clientX - rect.left) / rect.width) * renderSize.w,
    y: ((clientY - rect.top) / rect.height) * renderSize.h,
  };
  return toPageSpace(screenPt, renderScale);
}

export interface BoundingBox { minX: number; minY: number; maxX: number; maxY: number }

export function computeBoundingBox(points: Point[]): BoundingBox {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Euclidean distance from a point to the nearest point on a line segment (all in the same coordinate space). */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const proj: Point = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

/**
 * Hit test: is `p` within `tolerance` (in the SAME coordinate space as the
 * inputs — always call with page-space points and a page-space tolerance
 * derived from the current render scale, never a raw screen-pixel constant,
 * or the effective hit radius will silently change with zoom) of any vertex
 * or segment of `shape`?
 */
export function hitTestShape(p: Point, shape: Point[], tolerance: number): boolean {
  if (shape.length === 0) return false;
  if (shape.length === 1) return Math.hypot(p.x - shape[0].x, p.y - shape[0].y) <= tolerance;
  for (let i = 0; i < shape.length - 1; i++) {
    if (distanceToSegment(p, shape[i], shape[i + 1]) <= tolerance) return true;
  }
  return false;
}
