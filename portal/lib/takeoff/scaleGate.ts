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

/**
 * Postgres `numeric` arrives as a string. `Number.isFinite` rejects those
 * strings, so a verified sheet looked unscaled.
 */
export function finiteScaleFactor(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function sheetHasVerifiedScale(calibration: {
  status?: string | null;
  page_space_scale_factor?: unknown;
} | null | undefined): boolean {
  return calibration?.status === "verified"
    && finiteScaleFactor(calibration.page_space_scale_factor) != null;
}

export const SCALE_COACH_COPY =
  "Confirm the sheet scale against a known dimension before measuring.";
