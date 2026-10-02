export interface MatrixRow {
  id?: string;
  cost_code: string;
  description: string;
  quantity: number;
  unit: string;
  labor_unit: number;
  material_unit: number;
  equipment_unit: number;
  subcontractor_unit: number;
  trucking_unit: number;
  disposal_unit: number;
  notes: string;
  sort_order: number;
  _dirty?: boolean;
  _local?: string;
}

export interface SavedMatrixItem {
  id: string;
  cost_code: string | null;
  description: string | null;
  quantity: number | null;
  uom: string | null;
  labor_cost: number;
  material_cost: number;
  equipment_cost: number;
  trucking_cost: number;
  subcontract_cost: number;
  disposal_cost: number;
  notes: string | null;
  sort_order?: number;
}

const EDITABLE: Array<keyof MatrixRow> = [
  "cost_code", "description", "quantity", "unit",
  "labor_unit", "material_unit", "equipment_unit",
  "subcontractor_unit", "trucking_unit", "disposal_unit",
  "notes", "sort_order",
];

/** Converts stored dollar totals back into the grid's per-unit rates. */
export function itemToRow(item: SavedMatrixItem, index: number): MatrixRow {
  const quantity = item.quantity && item.quantity !== 0 ? item.quantity : 1;
  return {
    id: item.id,
    cost_code: item.cost_code ?? "",
    description: item.description ?? "",
    quantity: item.quantity ?? 0,
    unit: item.uom ?? "EA",
    labor_unit: item.labor_cost / quantity,
    material_unit: item.material_cost / quantity,
    equipment_unit: item.equipment_cost / quantity,
    subcontractor_unit: item.subcontract_cost / quantity,
    trucking_unit: item.trucking_cost / quantity,
    disposal_unit: item.disposal_cost / quantity,
    notes: item.notes ?? "",
    sort_order: item.sort_order ?? index,
    _dirty: false,
  };
}

function sameEditable(left: MatrixRow, right: MatrixRow): boolean {
  return EDITABLE.every((key) => left[key] === right[key]);
}

/**
 * Apply a save response without reloading the estimate.
 * A row the user changed while the request was in flight stays local and dirty.
 */
export function mergeSavedRows(current: MatrixRow[], saved: SavedMatrixItem[], snapshot: MatrixRow[]): MatrixRow[] {
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const snapshotById = new Map(snapshot.filter((row) => row.id).map((row) => [row.id as string, row]));
  return current.map((row, index) => {
    if (!row.id || !snapshotById.has(row.id)) return row;
    const frozen = snapshotById.get(row.id) as MatrixRow;
    if (!sameEditable(row, frozen)) return row;
    const item = savedById.get(row.id);
    if (!item) return row;
    return itemToRow(item, index);
  });
}
