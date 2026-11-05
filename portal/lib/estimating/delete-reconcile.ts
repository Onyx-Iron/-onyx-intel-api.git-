/**
 * Resolve which takeoff_items mirror ids should drive draft/review
 * estimate_items reconciliation after a manual takeoff soft-delete
 * (flag "Source removed" + zero pricing — not hard-delete).
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

/** Draft/review line after its takeoff source was deleted. Price is zeroed so the bid cannot keep the removed quantity. */
export function sourceRemovedEstimateFields(notes: string | null | undefined): {
  notes: string;
  pricing_status: "unpriced";
  labor_cost: 0;
  material_cost: 0;
  equipment_cost: 0;
  trucking_cost: 0;
  subcontract_cost: 0;
  disposal_cost: 0;
  total_direct_cost: 0;
  contingency: 0;
  overhead: 0;
  profit: 0;
  total_price: 0;
  unit_price: null;
  unit_cost: null;
} {
  const prior = (notes ?? "").trim();
  const nextNotes = prior.startsWith("Source removed") ? prior : `Source removed${prior ? ` — ${prior}` : ""}`;
  return {
    notes: nextNotes,
    pricing_status: "unpriced",
    labor_cost: 0,
    material_cost: 0,
    equipment_cost: 0,
    trucking_cost: 0,
    subcontract_cost: 0,
    disposal_cost: 0,
    total_direct_cost: 0,
    contingency: 0,
    overhead: 0,
    profit: 0,
    total_price: 0,
    unit_price: null,
    unit_cost: null,
  };
}

/**
 * Hard-delete of a takeoff row. Same zeroing as a manual soft-delete, and
 * the fingerprint is cleared so a later save of the same quantity can price
 * a new draft line instead of matching this removed one.
 */
export function detachedTakeoffEstimateFields(notes: string | null | undefined): ReturnType<typeof sourceRemovedEstimateFields> & {
  source_fingerprint: null;
} {
  return { ...sourceRemovedEstimateFields(notes), source_fingerprint: null };
}

/**
 * A rejected takeoff must not keep a live draft price. The fingerprint is
 * cleared so a later approval can price the line again instead of matching
 * this zeroed row and skipping the update.
 */
export function rejectedTakeoffEstimateFields(notes: string | null | undefined): ReturnType<typeof detachedTakeoffEstimateFields> & {
  indirect_cost: 0;
  other_direct_cost: 0;
  testing_cost: 0;
  quantity: 0;
} {
  const prior = (notes ?? "").replace(/\[onyx_takeoff_fingerprint:[^\]]+\]/g, "").trim();
  const nextNotes = prior.startsWith("Rejected") ? prior : `Rejected${prior ? ` — ${prior}` : ""}`;
  return {
    ...detachedTakeoffEstimateFields(null),
    notes: nextNotes,
    indirect_cost: 0,
    other_direct_cost: 0,
    testing_cost: 0,
    quantity: 0,
  };
}

export interface DraftEstimateLink {
  id: string;
  estimate_version_id: string;
  notes?: string | null;
}

/** Draft and review lines to zero after a takeoff item is rejected. Approved versions stay locked. */
export function planRejectedEstimateUpdates(
  linkedItems: DraftEstimateLink[],
  versions: Array<{ id: string; status: string }>,
): Array<{ id: string; fields: ReturnType<typeof rejectedTakeoffEstimateFields> }> {
  const draftIds = new Set(filterDraftEstimateItemIds(linkedItems, versions));
  return linkedItems
    .filter((item) => draftIds.has(item.id))
    .map((item) => ({ id: item.id, fields: rejectedTakeoffEstimateFields(item.notes) }));
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
