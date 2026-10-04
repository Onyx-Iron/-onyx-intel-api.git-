/**
 * Page takeoff is invoked again when a page retry follows a failure after
 * insert, and when page-split deletes `document_pages` and fans out new
 * page ids. `takeoff_items.sheet_id` is ON DELETE SET NULL, so the first
 * quantities remain. A second insert is approved and estimate sync prices
 * both copies.
 */

export interface ExistingPageTakeoff {
  id: string;
  sheet_id: string | null;
}

export type PageTakeoffWritePlan =
  | { action: "insert" }
  | { action: "keep"; keptCount: number; relinkIds: string[] };

export function planPageTakeoffWrite(
  existing: ExistingPageTakeoff[],
  pageId: string,
): PageTakeoffWritePlan {
  const byId = new Map<string, ExistingPageTakeoff>();
  for (const row of existing) {
    if (!row.id || byId.has(row.id)) continue;
    byId.set(row.id, row);
  }
  if (byId.size === 0) return { action: "insert" };
  const relinkIds = [...byId.values()]
    .filter((row) => row.sheet_id !== pageId)
    .map((row) => row.id);
  return { action: "keep", keptCount: byId.size, relinkIds };
}
