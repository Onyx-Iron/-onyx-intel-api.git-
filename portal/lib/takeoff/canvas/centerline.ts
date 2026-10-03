export interface CenterPoint {
  x: number;
  y: number;
}

function sub(a: CenterPoint, b: CenterPoint): CenterPoint {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: CenterPoint, b: CenterPoint): CenterPoint {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(a: CenterPoint, scale: number): CenterPoint {
  return { x: a.x * scale, y: a.y * scale };
}

function length(a: CenterPoint): number {
  return Math.hypot(a.x, a.y);
}

function unit(a: CenterPoint): CenterPoint {
  const span = length(a) || 1;
  return mul(a, 1 / span);
}

function leftNormal(direction: CenterPoint): CenterPoint {
  return { x: -direction.y, y: direction.x };
}

/**
 * Offset an open centerline by half the wall or paving thickness.
 * A straight run returns a rectangle whose area is length times full width.
 */
export function bufferCenterline(points: CenterPoint[], halfWidth: number): { area: number; ring: CenterPoint[] } {
  if (points.length < 2 || halfWidth <= 0) return { area: 0, ring: [] };
  const directions: CenterPoint[] = [];
  for (let i = 1; i < points.length; i++) directions.push(unit(sub(points[i], points[i - 1])));
  const left: CenterPoint[] = [];
  const right: CenterPoint[] = [];
  const startNormal = leftNormal(directions[0]);
  left.push(add(points[0], mul(startNormal, halfWidth)));
  right.push(add(points[0], mul(startNormal, -halfWidth)));
  for (let i = 1; i < points.length - 1; i++) {
    const previous = leftNormal(directions[i - 1]);
    const next = leftNormal(directions[i]);
    let miter = add(previous, next);
    const span = length(miter);
    if (span < 1e-6) {
      left.push(add(points[i], mul(previous, halfWidth)));
      right.push(add(points[i], mul(previous, -halfWidth)));
      continue;
    }
    miter = mul(miter, 1 / span);
    const dot = miter.x * previous.x + miter.y * previous.y;
    const scale = Math.min(halfWidth / Math.max(0.25, Math.abs(dot)), halfWidth * 4);
    left.push(add(points[i], mul(miter, scale)));
    right.push(add(points[i], mul(miter, -scale)));
  }
  const end = points[points.length - 1];
  const endNormal = leftNormal(directions[directions.length - 1]);
  left.push(add(end, mul(endNormal, halfWidth)));
  right.push(add(end, mul(endNormal, -halfWidth)));
  const ring = [...left, ...right.reverse()];
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return { area: Math.abs(sum) / 2, ring };
}
