export interface RevisionQuantity {
  cost_code: string | null;
  unit: string | null;
  quantity: number | null;
}

export interface RevisionDeltaRow {
  cost_code: string;
  unit: string;
  prior: number;
  current: number;
  delta: number;
}

const UNASSIGNED = "Unassigned";

function codeOf(value: string | null): string {
  const text = value?.trim();
  return text ? text : UNASSIGNED;
}

function unitOf(value: string | null): string {
  const text = value?.trim().toUpperCase();
  return text ? text : "EA";
}

function add(map: Map<string, number>, row: RevisionQuantity) {
  const key = `${codeOf(row.cost_code)}|${unitOf(row.unit)}`;
  const qty = Number(row.quantity);
  map.set(key, (map.get(key) ?? 0) + (Number.isFinite(qty) ? qty : 0));
}

/** Prior and current quantities for the same cost code and unit. A missing side is zero. */
export function compareRevisionQuantities(
  prior: RevisionQuantity[],
  current: RevisionQuantity[],
): RevisionDeltaRow[] {
  const priorMap = new Map<string, number>();
  const currentMap = new Map<string, number>();
  for (const row of prior) add(priorMap, row);
  for (const row of current) add(currentMap, row);
  const keys = new Set([...priorMap.keys(), ...currentMap.keys()]);
  return [...keys].map((key) => {
    const [cost_code, unit] = key.split("|");
    const priorQty = priorMap.get(key) ?? 0;
    const currentQty = currentMap.get(key) ?? 0;
    return {
      cost_code,
      unit,
      prior: priorQty,
      current: currentQty,
      delta: currentQty - priorQty,
    };
  }).sort((a, b) => {
    if (a.cost_code === UNASSIGNED) return 1;
    if (b.cost_code === UNASSIGNED) return -1;
    return a.cost_code.localeCompare(b.cost_code) || a.unit.localeCompare(b.unit);
  });
}
