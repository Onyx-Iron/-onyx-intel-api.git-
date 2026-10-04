/** Manual canvas rows stay off the estimate until their sheet scale is verified. */
export function isManualTakeoff(item: {
  source_method?: string | null;
  meta?: { extraction_method?: string | null } | null;
}): boolean {
  return item.source_method === "manual" || item.meta?.extraction_method === "manual";
}

export function excludeUnscaledManualTakeoff<T extends {
  source_method?: string | null;
  sheet_id?: string | null;
  meta?: { extraction_method?: string | null } | null;
}>(
  items: T[],
  verifiedPageIds: ReadonlySet<string>,
): { items: T[]; held: number } {
  const kept: T[] = [];
  let held = 0;
  for (const item of items) {
    if (isManualTakeoff(item) && (!item.sheet_id || !verifiedPageIds.has(item.sheet_id))) {
      held += 1;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, held };
}
