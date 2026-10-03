import earcut from "earcut";

export interface TessPoint {
  x: number;
  y: number;
}

/** Split a possibly non-convex ring into triangles for a shaded takeoff fill. */
export function triangulate(points: TessPoint[]): TessPoint[][] {
  if (points.length < 3) return [];
  const coords: number[] = [];
  for (const point of points) coords.push(point.x, point.y);
  const indices = earcut(coords);
  const triangles: TessPoint[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const tri: TessPoint[] = [];
    for (const index of [indices[i], indices[i + 1], indices[i + 2]]) {
      tri.push({ x: coords[index * 2], y: coords[index * 2 + 1] });
    }
    triangles.push(tri);
  }
  return triangles;
}

export function triangleFillPath(points: TessPoint[]): string {
  return triangulate(points)
    .map(([a, b, c]) => `M${a.x},${a.y} L${b.x},${b.y} L${c.x},${c.y} Z`)
    .join(" ");
}
