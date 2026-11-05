export interface QuantityGridRow {
  id: string;
  label: string;
  csiCode: string | null;
  division: string | null;
  quantity: number | string | null;
  unit: string | null;
  pageNumber: number | null;
  pageId: string | null;
  documentId: string | null;
}

/** Postgres numeric arrives as a string. Callers need a real number before toFixed or addition. */
export function finiteQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export interface QuantityGridGroup {
  division: string;
  name: string;
  rows: QuantityGridRow[];
  subtotals: Array<{ unit: string; quantity: number }>;
}

export function groupQuantitiesByDivision(
  rows: QuantityGridRow[],
  divisionName: (code: string) => string = (code) => code,
): QuantityGridGroup[] {
  const groups = new Map<string, QuantityGridRow[]>();
  for (const row of rows) {
    const division = (row.division || row.csiCode || "").replace(/\D/g, "").slice(0, 2) || "—";
    const list = groups.get(division) ?? [];
    list.push(row);
    groups.set(division, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([division, groupRows]) => {
      const byUnit = new Map<string, number>();
      for (const row of groupRows) {
        const quantity = finiteQuantity(row.quantity);
        if (quantity == null || !row.unit) continue;
        byUnit.set(row.unit, (byUnit.get(row.unit) ?? 0) + quantity);
      }
      return {
        division,
        name: division === "—" ? "Uncoded" : divisionName(division),
        rows: groupRows,
        subtotals: [...byUnit.entries()].map(([unit, quantity]) => ({ unit, quantity })),
      };
    });
}
