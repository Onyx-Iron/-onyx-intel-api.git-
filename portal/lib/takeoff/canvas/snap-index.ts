import RBush from "rbush";

export interface SnapPoint {
  x: number;
  y: number;
}

interface IndexedPoint extends SnapPoint {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** R-tree of drawing vertices. A cursor query only looks inside the snap radius. */
export function buildSnapIndex(points: SnapPoint[]): RBush<IndexedPoint> {
  const tree = new RBush<IndexedPoint>();
  tree.load(points.map((point) => ({
    x: point.x,
    y: point.y,
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y,
  })));
  return tree;
}

export function nearestSnap(index: RBush<IndexedPoint>, x: number, y: number, radiusPx: number): SnapPoint | null {
  if (radiusPx <= 0) return null;
  const hits = index.search({
    minX: x - radiusPx,
    minY: y - radiusPx,
    maxX: x + radiusPx,
    maxY: y + radiusPx,
  });
  let best: SnapPoint | null = null;
  let bestDistance = radiusPx * radiusPx;
  for (const hit of hits) {
    const dx = hit.x - x;
    const dy = hit.y - y;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = { x: hit.x, y: hit.y };
    }
  }
  return best;
}
