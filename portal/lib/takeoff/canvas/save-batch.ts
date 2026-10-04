export type HeldCanvasGroup = "utility runs" | "walls";

export interface CanvasSavePlan {
  postShapes: boolean;
  postUtilities: boolean;
  postTopo: boolean;
  postAreas: boolean;
  postWalls: boolean;
  /** Drawn before the sheet has a verified scale. Leave them unsaved. */
  heldForScale: HeldCanvasGroup[];
}

/**
 * Utility runs and walls need a verified sheet scale. Skipping the write
 * and then marking them saved drops them on the next reload.
 */
export function planCanvasSave(counts: {
  shapes: number;
  utilities: number;
  topo: number;
  areas: number;
  walls: number;
  pageSpaceReady: boolean;
}): CanvasSavePlan {
  const heldForScale: HeldCanvasGroup[] = [];
  if (counts.utilities > 0 && !counts.pageSpaceReady) heldForScale.push("utility runs");
  if (counts.walls > 0 && !counts.pageSpaceReady) heldForScale.push("walls");
  return {
    postShapes: counts.shapes > 0,
    postUtilities: counts.utilities > 0 && counts.pageSpaceReady,
    postTopo: counts.topo > 0,
    postAreas: counts.areas > 0,
    postWalls: counts.walls > 0 && counts.pageSpaceReady,
    heldForScale,
  };
}

export function heldForScaleMessage(held: HeldCanvasGroup[], savedOthers: boolean): string {
  const label = held.join(" and ");
  if (savedOthers) {
    return `Saved the other measurements. Set the sheet scale before saving ${label}. Those are still on the sheet and were not stored.`;
  }
  return `Set the sheet scale before saving ${label}. Those measurements are still on the sheet and were not stored.`;
}
