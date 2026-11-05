export interface BudgetSourceItem {
  id?: string;
  source_takeoff_id?: string | null;
  csi_code?: string | null;
  description?: string | null;
  quantity?: number | null;
  uom?: string | null;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  total_price?: number | null;
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

/** A stored budget line used to keep costs attached when a new budget is published. */
export interface CarryBudgetLine {
  id: string;
  source_takeoff_id?: string | null;
  csi_code?: string | null;
  description?: string | null;
  original_amount?: number | string | null;
  total_price?: number | string | null;
  approved_change_amount?: number | string | null;
  forecast_override?: number | string | null;
}

export interface BudgetLineCarry {
  fromId: string;
  toId: string;
  approvedChange: number;
  forecastOverride: number | null;
}

function money(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function moneyAmount(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function optionalMoney(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function takeoffKey(line: CarryBudgetLine): string | null {
  const id = line.source_takeoff_id?.trim();
  return id ? `takeoff:${id}` : null;
}

function textKey(line: CarryBudgetLine): string | null {
  const description = (line.description ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!description) return null;
  const csi = (line.csi_code ?? "").trim().toLowerCase();
  return `text:${csi}\n${description}`;
}

function uniqueBy(lines: CarryBudgetLine[], keyOf: (line: CarryBudgetLine) => string | null): Map<string, CarryBudgetLine> {
  const counts = new Map<string, number>();
  const first = new Map<string, CarryBudgetLine>();
  for (const line of lines) {
    const key = keyOf(line);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!first.has(key)) first.set(key, line);
  }
  const unique = new Map<string, CarryBudgetLine>();
  for (const [key, count] of counts) {
    if (count === 1) {
      const line = first.get(key);
      if (line) unique.set(key, line);
    }
  }
  return unique;
}

function toCarry(previous: CarryBudgetLine, next: CarryBudgetLine): BudgetLineCarry {
  return {
    fromId: previous.id,
    toId: next.id,
    approvedChange: moneyAmount(previous.approved_change_amount),
    forecastOverride: optionalMoney(previous.forecast_override),
  };
}

/**
 * Pair a replaced budget's lines with the new snapshot.
 * A takeoff id matches first. Otherwise the CSI code and description match.
 * A key that appears more than once on either side is left unmapped.
 */
export function matchBudgetLineCarryForward(
  previous: CarryBudgetLine[],
  next: CarryBudgetLine[],
): BudgetLineCarry[] {
  const carries: BudgetLineCarry[] = [];
  const matchedPrevious = new Set<string>();
  const matchedNext = new Set<string>();
  const previousTakeoff = uniqueBy(previous, takeoffKey);
  const nextTakeoff = uniqueBy(next, takeoffKey);
  for (const [key, prior] of previousTakeoff) {
    const successor = nextTakeoff.get(key);
    if (!successor || prior.id === successor.id) continue;
    matchedPrevious.add(prior.id);
    matchedNext.add(successor.id);
    carries.push(toCarry(prior, successor));
  }

  const previousText = uniqueBy(previous.filter((line) => !matchedPrevious.has(line.id)), textKey);
  const nextText = uniqueBy(next.filter((line) => !matchedNext.has(line.id)), textKey);
  for (const [key, prior] of previousText) {
    const successor = nextText.get(key);
    if (!successor || prior.id === successor.id) continue;
    carries.push(toCarry(prior, successor));
  }
  return carries;
}

/** Live project budget after carried approved changes are applied to the new lines. */
export function revisedBudgetAfterCarry(lines: CarryBudgetLine[], carries: BudgetLineCarry[]): number {
  const carriedChange = new Map(carries.map((carry) => [carry.toId, carry.approvedChange]));
  const total = lines.reduce((sum, line) => {
    const original = moneyAmount(line.original_amount ?? line.total_price);
    const approved = carriedChange.has(line.id)
      ? carriedChange.get(line.id) ?? 0
      : moneyAmount(line.approved_change_amount);
    return sum + original + approved;
  }, 0);
  return Math.round(total * 100) / 100;
}
