export interface QtyRow {
  tool: string;
  costCode: string;
  unit: string;
  quantity: number;
  count: number;
}

export interface QtyShapeLike {
  tool: string;
  cost_code?: string | null;
  quantity: number;
  unit?: string | null;
}

/** Aggregate takeoff shapes into a PlanSwift-style CSI quantity legend. */
export function buildQuantitySummary(shapes: QtyShapeLike[]): QtyRow[] {
  const map = new Map<string, QtyRow>();
  for (const s of shapes) {
    const costCode = (s.cost_code ?? "00-00-00").trim() || "00-00-00";
    const unit = (s.unit ?? (s.tool === "count" ? "EA" : s.tool === "length" ? "LF" : "SF")).toUpperCase();
    const key = `${costCode}|${unit}|${s.tool}`;
    const row = map.get(key) ?? {
      tool: s.tool,
      costCode,
      unit,
      quantity: 0,
      count: 0,
    };
    row.quantity += Number(s.quantity) || 0;
    row.count += 1;
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.costCode.localeCompare(b.costCode) || a.unit.localeCompare(b.unit),
  );
}
