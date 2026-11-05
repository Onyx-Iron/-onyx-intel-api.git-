export interface BudgetSourceItem {
  id?: string;
  source_takeoff_id?: string | null;
  csi_code?: string | null;
  description?: string | null;
  quantity?: number | null;
  uom?: string | null;
  labor_cost?: number | string | null;
  material_cost?: number | string | null;
  equipment_cost?: number | string | null;
  total_price?: number | string | null;
  sort_order?: number | null;
}

export interface BudgetLineSnapshot {
  source_estimate_item_id: string | null;
  source_takeoff_id: string | null;
  csi_code: string | null;
  description: string;
  quantity: number | null;
  uom: string | null;
  labor_cost: number;
  material_cost: number;
  equipment_cost: number;
  total_price: number;
  sort_order: number;
}

export interface BudgetSnapshot {
  lines: BudgetLineSnapshot[];
  totalPrice: number;
  lineCount: number;
}

/** Postgres `numeric` columns arrive as strings. Blank and non-numeric values are 0. */
function money(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Copy the lines of one estimate version. The caller must pass that version's rows. */
export function snapshotBudget(items: BudgetSourceItem[]): BudgetSnapshot {
  const lines = items.map((item, index) => ({
    source_estimate_item_id: item.id ?? null,
    source_takeoff_id: item.source_takeoff_id ?? null,
    csi_code: item.csi_code ?? null,
    description: (item.description ?? "").trim() || "Estimate line",
    quantity: item.quantity ?? null,
    uom: item.uom ?? null,
    labor_cost: money(item.labor_cost),
    material_cost: money(item.material_cost),
    equipment_cost: money(item.equipment_cost),
    total_price: money(item.total_price),
    sort_order: item.sort_order ?? index,
  }));
  const totalPrice = lines.reduce((sum, line) => sum + line.total_price, 0);
  return { lines, totalPrice, lineCount: lines.length };
}
