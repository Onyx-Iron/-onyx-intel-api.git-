export type StoredTakeoffType = "count" | "length" | "area";
export type DisplayTakeoffTool = StoredTakeoffType | "perimeter";

/** Perimeter is stored as a closed length because the database allows count, length, and area. */
export function storedTakeoffType(tool: string): StoredTakeoffType {
  if (tool === "count" || tool === "area") return tool;
  return "length";
}

export function displayTakeoffTool(type: string, measure?: string | null): DisplayTakeoffTool {
  if (measure === "perimeter" || type === "perimeter" || type === "perim") return "perimeter";
  if (type === "count" || type === "area" || type === "length") return type;
  return "length";
}

export function measurementUnit(tool: string): "EA" | "LF" | "SF" {
  if (tool === "count") return "EA";
  if (tool === "area") return "SF";
  return "LF";
}
