/** PostgREST `max_rows` in supabase/config.toml. A single select never returns more. */
export const CALIBRATION_PAGE_SIZE = 1000;

const MAX_CALIBRATION_PAGES = 200;

export interface CalibrationPage {
  data: Array<{ page_id: string }> | null;
  error: { message: string } | null;
}

/**
 * Every verified sheet on the project. One select stops at CALIBRATION_PAGE_SIZE,
 * and the sheets past that cap are treated as unscaled, so their manual
 * quantities never reach the bid. A failed or oversized read returns no ids
 * so a partial page is not mistaken for the full set.
 */
export async function loadVerifiedCalibrationPageIds(
  fetchPage: (from: number, to: number) => PromiseLike<CalibrationPage>,
  pageSize = CALIBRATION_PAGE_SIZE,
): Promise<{ pageIds: string[]; error: string | null }> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return { pageIds: [], error: "pageSize must be a positive integer" };
  }
  const pageIds: string[] = [];
  let from = 0;
  for (let page = 0; page < MAX_CALIBRATION_PAGES; page++) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { pageIds: [], error: error.message };
    const batch = data ?? [];
    for (const row of batch) pageIds.push(row.page_id);
    if (batch.length < pageSize) return { pageIds, error: null };
    from += pageSize;
  }
  return { pageIds: [], error: `Verified scales exceeded ${MAX_CALIBRATION_PAGES * pageSize} rows` };
}

/** Manual canvas rows stay off the estimate until their sheet scale is verified. */
type ScaleGate = {
  source_method?: string | null;
  sheet_id?: string | null;
  meta?: { extraction_method?: string | null } | null;
};

export function isManualTakeoff(item: {
  source_method?: string | null;
  meta?: { extraction_method?: string | null } | null;
}): boolean {
  return item.source_method === "manual" || item.meta?.extraction_method === "manual";
}

export function excludeUnscaledManualTakeoff<T>(
  items: readonly T[],
  verifiedPageIds: ReadonlySet<string>,
): { items: T[]; held: number } {
  const kept: T[] = [];
  let held = 0;
  for (const item of items) {
    // The takeoff query is read through a service client typed as `any`.
    // A constrained type parameter collapses that `any` to the constraint
    // and drops id/csi_code before estimate import.
    const row = item as T & ScaleGate;
    if (isManualTakeoff(row) && (!row.sheet_id || !verifiedPageIds.has(row.sheet_id))) {
      held += 1;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, held };
}
