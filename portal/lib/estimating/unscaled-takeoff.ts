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
