export interface RingPoint {
  x: number;
  y: number;
}

/** Shoelace area of one ring, in the coordinate units squared. */
export function ringArea(points: RingPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Outer ring minus named holes (a shaft inside a slab). */
export function netArea(outer: RingPoint[], holes: RingPoint[][] = []): number {
  const holeArea = holes.reduce((sum, hole) => sum + ringArea(hole), 0);
  return Math.max(0, ringArea(outer) - holeArea);
}
