/** Rows tagged ai_vision are not inserted. Measurement does not use them. */
export function dropAiVisionRows<T extends { extraction_method?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.extraction_method !== "ai_vision");
}

/** Content key matching apply_vision_extraction_takeoff_items. */
export function visionItemKey(item: { description?: string | null; quantity?: number | null; unit?: string | null }): string {
  const qty = typeof item.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : 0;
  const rounded = (Math.round((qty + Number.EPSILON) * 10000) / 10000).toFixed(4);
  return `${(item.description ?? "").trim().toLowerCase()}|${rounded}|${(item.unit ?? "").trim().toLowerCase()}`;
}

export function countAlreadyDecided(
  items: Array<{ description?: string | null; quantity?: number | null; unit?: string | null }>,
  decidedKeys: string[],
): number {
  const decided = new Set(decidedKeys.map((key) => key.trim().toLowerCase()));
  let count = 0;
  for (const item of items) {
    if (decided.has(visionItemKey(item))) count += 1;
  }
  return count;
}
