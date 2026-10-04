import {
  calculateCount,
  calculateLinearLength,
  calculatePerimeter,
  calculatePolygonArea,
} from "@/lib/takeoff/canvas/quantity";

export type EditableShapeTool = "count" | "length" | "area" | "perimeter";

/**
 * Live quantity for a shape after a vertex (or whole-object) edit.
 * `pageSpaceScaleFactor` is real-world units per page-space unit — only used
 * for length/area/perimeter. Count ignores calibration.
 */
export function recomputeShapeQuantity(
  tool: EditableShapeTool,
  points: ReadonlyArray<{ x: number; y: number }>,
  pageSpaceScaleFactor: number,
): number {
  if (tool === "count") return calculateCount([...points]);
  if (tool === "length") return calculateLinearLength([...points], pageSpaceScaleFactor);
  if (tool === "perimeter") return calculatePerimeter([...points], pageSpaceScaleFactor);
  return calculatePolygonArea([...points], pageSpaceScaleFactor);
}

/** True when a vertex index is editable for the tool (length/area/perimeter polylines). */
export function canEditVertex(tool: EditableShapeTool, pointCount: number, vertexIndex: number): boolean {
  if (vertexIndex < 0 || vertexIndex >= pointCount) return false;
  if (tool === "count") return pointCount >= 1;
  if (tool === "length") return pointCount >= 2;
  // area + perimeter are closed shapes
  return pointCount >= 3;
}
