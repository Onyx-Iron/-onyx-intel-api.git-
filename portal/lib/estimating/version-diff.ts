import { MONEY_EPSILON, moneyDiffers } from "./money";

export interface VersionDiffItem {
  id?: string;
  source_takeoff_id?: string | null;
  csi_code?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  total_price?: number | null;
  drawing_ref?: string | null;
  quantity_basis?: string | null;
}

export type VersionDiffChangeKind = "quantity" | "unit_cost" | "total_price" | "source";

export interface VersionDiffChange {
  key: string;
  left: VersionDiffItem;
  right: VersionDiffItem;
  changes: VersionDiffChangeKind[];
  quantityDelta: number | null;
  unitCostDelta: number | null;
  totalDelta: number | null;
}

export interface VersionDiff {
  added: VersionDiffItem[];
  removed: VersionDiffItem[];
  changed: VersionDiffChange[];
  unchangedCount: number;
}

const QUANTITY_EPSILON = 1e-6;

function itemKey(item: VersionDiffItem): string {
  const source = item.source_takeoff_id?.trim();
  if (source) return `takeoff:${source}`;
  const csi = (item.csi_code ?? "").trim().toLowerCase();
  const description = (item.description ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `line:${csi}|${description}`;
}

function delta(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left == null && right == null) return null;
  return (right ?? 0) - (left ?? 0);
}

function classifyChange(left: VersionDiffItem, right: VersionDiffItem): VersionDiffChangeKind[] {
  const changes: VersionDiffChangeKind[] = [];
  const lq = left.quantity ?? 0;
  const rq = right.quantity ?? 0;
  if (Math.abs(lq - rq) > QUANTITY_EPSILON) changes.push("quantity");
  if (moneyDiffers(left.unit_cost ?? 0, right.unit_cost ?? 0, MONEY_EPSILON)) changes.push("unit_cost");
  if (moneyDiffers(left.total_price ?? 0, right.total_price ?? 0, MONEY_EPSILON)) changes.push("total_price");
  const leftSource = `${left.drawing_ref ?? ""}|${left.quantity_basis ?? ""}`;
  const rightSource = `${right.drawing_ref ?? ""}|${right.quantity_basis ?? ""}`;
  if (leftSource !== rightSource) changes.push("source");
  return changes;
}

interface FlatItem {
  key: string;
  index: number;
  item: VersionDiffItem;
}

function flatten(items: VersionDiffItem[]): FlatItem[] {
  return items.map((item, index) => ({ key: itemKey(item), index, item }));
}

function groupByKey(items: FlatItem[]): Map<string, FlatItem[]> {
  const grouped = new Map<string, FlatItem[]>();
  for (const entry of items) {
    const bucket = grouped.get(entry.key);
    if (bucket) bucket.push(entry);
    else grouped.set(entry.key, [entry]);
  }
  return grouped;
}

/**
 * Diff two estimate versions.
 *
 * Keys prefer source_takeoff_id, else CSI+description. Duplicate keys inside
 * one side are paired in sheet order (so two identical "Elbow, 2in" lines are
 * not reported as one add + one delete when a neighbour moves). Money fields
 * ignore sub-cent drift.
 */
export function diffEstimateVersions(leftItems: VersionDiffItem[], rightItems: VersionDiffItem[]): VersionDiff {
  const leftFlat = flatten(leftItems);
  const rightFlat = flatten(rightItems);
  const leftByKey = groupByKey(leftFlat);

  const added: VersionDiffItem[] = [];
  const removed: VersionDiffItem[] = [];
  const changed: VersionDiffChange[] = [];
  let unchangedCount = 0;

  for (const entry of rightFlat) {
    const bucket = leftByKey.get(entry.key);
    if (!bucket || bucket.length === 0) {
      added.push(entry.item);
      continue;
    }
    const left = bucket.shift()!.item;
    const changes = classifyChange(left, entry.item);
    if (changes.length === 0) {
      unchangedCount += 1;
      continue;
    }
    changed.push({
      key: entry.key,
      left,
      right: entry.item,
      changes,
      quantityDelta: delta(left.quantity, entry.item.quantity),
      unitCostDelta: delta(left.unit_cost, entry.item.unit_cost),
      totalDelta: delta(left.total_price, entry.item.total_price),
    });
  }

  const leftover: FlatItem[] = [];
  for (const bucket of leftByKey.values()) leftover.push(...bucket);
  leftover.sort((a, b) => a.index - b.index);
  for (const entry of leftover) removed.push(entry.item);

  return { added, removed, changed, unchangedCount };
}
