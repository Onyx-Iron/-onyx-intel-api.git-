import type { CanvasTool } from "@/lib/takeoff/canvas/hotkeys";

/** Tools that write sheet geometry and must not run without a verified scale. */
const SCALE_GATED_TOOLS: ReadonlySet<CanvasTool> = new Set([
  "count",
  "length",
  "area",
  "perimeter",
  "utility_pipe",
  "spot_elevation",
  "contour_line",
  "civil_area_bounds",
]);

export function toolRequiresVerifiedScale(tool: CanvasTool): boolean {
  return SCALE_GATED_TOOLS.has(tool);
}

export function sheetHasVerifiedScale(calibration: {
  status?: string | null;
  page_space_scale_factor?: number | null;
} | null | undefined): boolean {
  return calibration?.status === "verified"
    && calibration.page_space_scale_factor != null
    && Number.isFinite(calibration.page_space_scale_factor);
}

export const SCALE_COACH_COPY =
  "Confirm the sheet scale against a known dimension before measuring.";
