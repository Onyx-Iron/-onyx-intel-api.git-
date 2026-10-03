export interface Polyline {
  points: Array<{ x: number; y: number }>;
}

function quantize(value: number): number {
  return Math.round(value * 2) / 2;
}

function signature(line: Polyline): string {
  return line.points.map((point) => `${quantize(point.x)},${quantize(point.y)}`).join(";");
}

export function polylinesFromUnknown(vectors: unknown): Polyline[] {
  if (!Array.isArray(vectors)) return [];
  const lines: Polyline[] = [];
  for (const entry of vectors) {
    if (!entry || typeof entry !== "object") continue;
    const points = (entry as { points?: unknown }).points;
    if (!Array.isArray(points) || points.length < 2) continue;
    const parsed: Array<{ x: number; y: number }> = [];
    for (const point of points) {
      if (Array.isArray(point) && point.length >= 2) {
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) parsed.push({ x, y });
        continue;
      }
      if (!point || typeof point !== "object") continue;
      const x = Number((point as { x?: unknown }).x);
      const y = Number((point as { y?: unknown }).y);
      if (Number.isFinite(x) && Number.isFinite(y)) parsed.push({ x, y });
    }
    if (parsed.length >= 2) lines.push({ points: parsed });
  }
  return lines;
}

/**
 * Geometry on the current sheet that is not on the prior revision is added.
 * Geometry on the prior sheet that is not on the current one is removed.
 * Matching polylines are unchanged and are not returned.
 */
export function diffRevisionVectors(current: Polyline[], prior: Polyline[]): { added: Polyline[]; removed: Polyline[] } {
  const priorCounts = new Map<string, number>();
  for (const line of prior) {
    const key = signature(line);
    priorCounts.set(key, (priorCounts.get(key) ?? 0) + 1);
  }
  const added: Polyline[] = [];
  for (const line of current) {
    const key = signature(line);
    const remaining = priorCounts.get(key) ?? 0;
    if (remaining > 0) priorCounts.set(key, remaining - 1);
    else added.push(line);
  }
  const removed: Polyline[] = [];
  for (const line of prior) {
    const key = signature(line);
    const remaining = priorCounts.get(key) ?? 0;
    if (remaining > 0) {
      removed.push(line);
      priorCounts.set(key, remaining - 1);
    }
  }
  return { added, removed };
}
