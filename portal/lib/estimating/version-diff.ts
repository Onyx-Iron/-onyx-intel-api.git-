export interface VersionDiffItem {
  id?: string;
  source_takeoff_id?: string | null;
  csi_code?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  total_price?: number | null;
}

export interface VersionDiffChange {
  key: string;
  left: VersionDiffItem;
  right: VersionDiffItem;
  quantityDelta: number | null;
  unitCostDelta: number | null;
  totalDelta: number | null;
}

export interface VersionDiff {
  added: VersionDiffItem[];
  removed: VersionDiffItem[];
  changed: VersionDiffChange[];
}

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

function changedFields(left: VersionDiffItem, right: VersionDiffItem): boolean {
  return left.quantity !== right.quantity
    || left.unit_cost !== right.unit_cost
    || left.total_price !== right.total_price;
}

export function diffEstimateVersions(leftItems: VersionDiffItem[], rightItems: VersionDiffItem[]): VersionDiff {
  const leftByKey = new Map<string, VersionDiffItem>();
  for (const item of leftItems) leftByKey.set(itemKey(item), item);

  const rightByKey = new Map<string, VersionDiffItem>();
  for (const item of rightItems) rightByKey.set(itemKey(item), item);

  const added: VersionDiffItem[] = [];
  const removed: VersionDiffItem[] = [];
  const changed: VersionDiffChange[] = [];

  for (const [key, right] of rightByKey) {
    const left = leftByKey.get(key);
    if (!left) {
      added.push(right);
      continue;
    }
    if (!changedFields(left, right)) continue;
    changed.push({
      key,
      left,
      right,
      quantityDelta: delta(left.quantity, right.quantity),
      unitCostDelta: delta(left.unit_cost, right.unit_cost),
      totalDelta: delta(left.total_price, right.total_price),
    });
  }

  for (const [key, left] of leftByKey) {
    if (!rightByKey.has(key)) removed.push(left);
  }

  return { added, removed, changed };
}
