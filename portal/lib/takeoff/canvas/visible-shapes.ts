export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function worldBoxFromPoints(points: ReadonlyArray<readonly [number, number]>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned bbox from `{x,y}` points (SheetCanvas display space). */
export function boxFromXY(points: ReadonlyArray<{ x: number; y: number }>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function shapesInView<T extends { bbox: Box }>(shapes: T[], view: Box, pad = 0): T[] {
  const padded: Box = {
    minX: view.minX - pad,
    minY: view.minY - pad,
    maxX: view.maxX + pad,
    maxY: view.maxY + pad,
  };
  return shapes.filter((shape) => boxesIntersect(shape.bbox, padded));
}

/**
 * Cull measurement overlays to the visible canvas window. Always keeps
 * `keepKeys` (selection / unsaved drafts) so interaction does not drop them
 * when they scroll just off-screen.
 */
export function cullByView<T extends { key: string; bbox: Box | null }>(
  items: T[],
  view: Box | null,
  opts?: { pad?: number; keepKeys?: ReadonlySet<string> },
): T[] {
  if (!view) return items;
  const pad = opts?.pad ?? 0;
  const keepKeys = opts?.keepKeys;
  const padded: Box = {
    minX: view.minX - pad,
    minY: view.minY - pad,
    maxX: view.maxX + pad,
    maxY: view.maxY + pad,
  };
  return items.filter((item) => {
    if (keepKeys?.has(item.key)) return true;
    if (!item.bbox) return true;
    return boxesIntersect(item.bbox, padded);
  });
}
