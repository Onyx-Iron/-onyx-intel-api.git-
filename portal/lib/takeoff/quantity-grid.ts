export interface QuantityGridRow {
  id: string;
  label: string;
  csiCode: string | null;
  division: string | null;
  quantity: number | null;
  unit: string | null;
  pageNumber: number | null;
  pageId: string | null;
  documentId: string | null;
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
        if (row.quantity == null || !row.unit) continue;
        byUnit.set(row.unit, (byUnit.get(row.unit) ?? 0) + row.quantity);
      }
      return {
        division,
        name: division === "—" ? "Uncoded" : divisionName(division),
        rows: groupRows,
        subtotals: [...byUnit.entries()].map(([unit, quantity]) => ({ unit, quantity })),
      };
    });
}
