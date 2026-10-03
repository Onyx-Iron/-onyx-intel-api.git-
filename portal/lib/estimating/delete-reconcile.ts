/**
 * Resolve which takeoff_items mirror ids should lose their draft/review
 * estimate_items after a manual takeoff soft-delete.
 *
 * Prefer the outbox payload's `mirror_id` (written by soft_delete_manual_takeoff_tx)
 * so retained mirrors (locked estimate refs) still reconcile sibling draft lines.
 * Fall back to takeoff_item_history 'deleted' snapshots when payload is missing.
 */
export function collectDeletedMirrorIds(opts: {
  payloadMirrorId?: string | null;
  historyTakeoffItemIds?: Array<string | null | undefined>;
  retainedMirrorIds?: Array<string | null | undefined>;
}): string[] {
  const ids = new Set<string>();
  if (opts.payloadMirrorId) ids.add(opts.payloadMirrorId);
  for (const id of opts.historyTakeoffItemIds ?? []) {
    if (id) ids.add(id);
  }
  for (const id of opts.retainedMirrorIds ?? []) {
    if (id) ids.add(id);
  }
  return [...ids];
}

export function filterDraftEstimateItemIds(
  linkedItems: Array<{ id: string; estimate_version_id: string }>,
  versions: Array<{ id: string; status: string }>,
): string[] {
  const draftVersionIds = new Set(
    versions
      .filter((v) => v.status === "draft" || v.status === "review")
      .map((v) => v.id),
  );
  return linkedItems
    .filter((item) => draftVersionIds.has(item.estimate_version_id))
    .map((item) => item.id);
}
