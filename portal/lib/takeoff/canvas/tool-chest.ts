import { calculatedQuantityForSave } from "./quantity";

export const TOOL_KINDS = ["count", "length", "area"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export interface TakeoffTool {
  name: string;
  cost_code: string;
  unit: string;
  tool: ToolKind;
}

export function isToolKind(value: string): value is ToolKind {
  return (TOOL_KINDS as readonly string[]).includes(value);
}

/**
 * A chest tool places a measurement that already carries its CSI code.
 * A count stores quantity 1 immediately. Length and area stay null until a verified scale covers them.
 */
export function placeFromTool(
  tool: TakeoffTool,
  verifiedScale: boolean,
  measuredQuantity: number | null,
): {
  name: string;
  cost_code: string;
  unit: string;
  takeoff_type: ToolKind;
  calculated_quantity: number | null;
} {
  const calculated = tool.tool === "count"
    ? 1
    : calculatedQuantityForSave(verifiedScale, measuredQuantity);
  return {
    name: tool.name,
    cost_code: tool.cost_code,
    unit: tool.unit,
    takeoff_type: tool.tool,
    calculated_quantity: calculated,
  };
}
