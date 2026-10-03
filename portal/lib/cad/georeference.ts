export interface SurveyPoint {
  x: number;
  y: number;
}

export interface SheetTransform {
  scale: number;
  rotation_rad: number;
  tx: number;
  ty: number;
  epsg: number;
}

/** Two sheet clicks and two state-plane coordinates. The tie is not stored on the project row. */
export function fitSheetTransform(
  sheetA: SurveyPoint,
  sheetB: SurveyPoint,
  worldA: SurveyPoint,
  worldB: SurveyPoint,
  epsg = 2276,
): SheetTransform {
  const sheetLength = Math.hypot(sheetB.x - sheetA.x, sheetB.y - sheetA.y);
  const worldLength = Math.hypot(worldB.x - worldA.x, worldB.y - worldA.y);
  if (sheetLength === 0 || worldLength === 0) {
    throw new Error("the two sheet points and the two survey points must be distinct");
  }
  const scale = worldLength / sheetLength;
  const rotation = Math.atan2(worldB.y - worldA.y, worldB.x - worldA.x) - Math.atan2(sheetB.y - sheetA.y, sheetB.x - sheetA.x);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const rotatedX = scale * (cosine * sheetA.x - sine * sheetA.y);
  const rotatedY = scale * (sine * sheetA.x + cosine * sheetA.y);
  return {
    scale,
    rotation_rad: rotation,
    tx: worldA.x - rotatedX,
    ty: worldA.y - rotatedY,
    epsg,
  };
}

export function applySheetTransform(points: SurveyPoint[], transform: SheetTransform): SurveyPoint[] {
  const cosine = Math.cos(transform.rotation_rad);
  const sine = Math.sin(transform.rotation_rad);
  return points.map((point) => ({
    x: transform.scale * (cosine * point.x - sine * point.y) + transform.tx,
    y: transform.scale * (sine * point.x + cosine * point.y) + transform.ty,
  }));
}
