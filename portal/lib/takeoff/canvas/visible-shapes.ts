export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
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
