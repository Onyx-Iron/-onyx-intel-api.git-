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

/**
 * True when this page must not emit quantities because the parent plan is a
 * finished partial that the estimator has not accepted.
 *
 * A multi-batch split can be stamped `complete_with_errors` after the first
 * pages finish and before later pages exist (`pages_split_through` still
 * behind `pages_total`). Those later pages were explicitly enqueued and must
 * still extract — skipping them leaves the set looking complete with most
 * quantities missing and Retry hidden.
 */
export function shouldSkipTakeoffForPartialDocument(doc: {
  status?: string | null;
  meta?: unknown;
} | null | undefined): boolean {
  if (!doc || doc.status !== "complete_with_errors") return false;
  const meta = doc.meta && typeof doc.meta === "object" && !Array.isArray(doc.meta)
    ? doc.meta as Record<string, unknown>
    : {};
  if (meta.partial_acknowledged === true) return false;
  const summary = typeof meta.processing_summary === "object" && meta.processing_summary
    ? meta.processing_summary as Record<string, unknown>
    : {};
  const through = summary.pages_split_through;
  const total = summary.pages_total;
  if (typeof through === "number" && typeof total === "number" && through < total) return false;
  return true;
}

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
