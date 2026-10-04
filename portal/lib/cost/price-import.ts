/**
 * Parse a company price sheet into cost_overrides rows.
 * A row needs a CSI code and a positive unit cost. A labor, material, and
 * equipment trio is kept only when all three are present and they add up
 * to that unit cost.
 */

export interface ParsedPriceRow {
  line: number;
  csi_code: string;
  description: string | null;
  unit: string | null;
  unit_cost: number;
  labor_cost: number | null;
  material_cost: number | null;
  equipment_cost: number | null;
  region_code: string | null;
  effective_from: string | null;
}

export interface PriceReject {
  line: number;
  reason: string;
  csi_code?: string;
}

export interface PriceImportParse {
  rows: ParsedPriceRow[];
  rejected: PriceReject[];
}

const HEADER_ALIASES: Record<string, string> = {
  csi: "csi_code",
  csi_code: "csi_code",
  cost_code: "csi_code",
  code: "csi_code",
  description: "description",
  desc: "description",
  item: "description",
  unit: "unit",
  uom: "unit",
  unit_cost: "unit_cost",
  unit_price: "unit_cost",
  rate: "unit_cost",
  price: "unit_cost",
  labor: "labor_cost",
  labor_cost: "labor_cost",
  material: "material_cost",
  material_cost: "material_cost",
  equipment: "equipment_cost",
  equipment_cost: "equipment_cost",
  region: "region_code",
  region_code: "region_code",
  effective_from: "effective_from",
  effective_date: "effective_from",
  date: "effective_from",
};

const UNIT_ALIASES: Record<string, string> = {
  LF: "LF",
  FT: "LF",
  FEET: "LF",
  FOOT: "LF",
  SF: "SF",
  SQFT: "SF",
  CY: "CY",
  CUYD: "CY",
  EA: "EA",
  EACH: "EA",
  LS: "LS",
  TON: "TON",
  LB: "LB",
};

export function normalizeCsiCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 6) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
}

export function normalizeUnitToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const token = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!token) return null;
  return UNIT_ALIASES[token] ?? token;
}

export function unitsMatch(csvUnit: string | null, codeUnit: string | null): boolean {
  const left = normalizeUnitToken(csvUnit);
  const right = normalizeUnitToken(codeUnit);
  if (!left || !right) return true;
  return left === right;
}

function parseMoney(raw: string | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string | undefined): { value: string | null; invalid: boolean } {
  if (raw == null || !raw.trim()) return { value: null, invalid: false };
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { value: text, invalid: false };
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const month = slash[1].padStart(2, "0");
    const day = slash[2].padStart(2, "0");
    return { value: `${slash[3]}-${month}-${day}`, invalid: false };
  }
  return { value: null, invalid: true };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else if (ch === "\"") {
        quoted = false;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "\"") {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function headerIndex(cells: string[]): Record<string, number> | null {
  const index: Record<string, number> = {};
  let recognized = 0;
  cells.forEach((cell, i) => {
    const key = HEADER_ALIASES[cell.trim().toLowerCase().replace(/\s+/g, "_")];
    if (!key) return;
    index[key] = i;
    recognized += 1;
  });
  if (recognized === 0 || index.csi_code == null || index.unit_cost == null) return null;
  return index;
}

function cell(cells: string[], index: Record<string, number>, key: string): string | undefined {
  const at = index[key];
  return at == null ? undefined : cells[at];
}

const POSITIONAL: Record<string, number> = {
  csi_code: 0,
  description: 1,
  unit: 2,
  unit_cost: 3,
  labor_cost: 4,
  material_cost: 5,
  equipment_cost: 6,
  region_code: 7,
  effective_from: 8,
};

export function parsePriceCsv(csv: string): PriceImportParse {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const rejected: PriceReject[] = [];
  const rows: ParsedPriceRow[] = [];
  let header: Record<string, number> | null = null;
  let started = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const cells = splitCsvLine(raw);
    if (!started) {
      header = headerIndex(cells);
      started = true;
      if (header) continue;
      header = POSITIONAL;
    }
    const line = i + 1;
    const columns = header ?? POSITIONAL;
    const csi = normalizeCsiCode(cell(cells, columns, "csi_code") ?? "");
    if (!csi) {
      rejected.push({ line, reason: "cost code is required" });
      continue;
    }
    const unitCost = parseMoney(cell(cells, columns, "unit_cost"));
    if (unitCost == null || unitCost <= 0) {
      rejected.push({ line, csi_code: csi, reason: "unit cost must be greater than zero" });
      continue;
    }
    const dated = parseDate(cell(cells, columns, "effective_from"));
    if (dated.invalid) {
      rejected.push({ line, csi_code: csi, reason: "effective date is not a date" });
      continue;
    }
    const labor = parseMoney(cell(cells, columns, "labor_cost"));
    const material = parseMoney(cell(cells, columns, "material_cost"));
    const equipment = parseMoney(cell(cells, columns, "equipment_cost"));
    const splitReady = labor != null && material != null && equipment != null
      && Math.abs(labor + material + equipment - unitCost) <= 0.01;
    const description = (cell(cells, columns, "description") ?? "").trim();
    const region = (cell(cells, columns, "region_code") ?? "").trim();
    const unit = (cell(cells, columns, "unit") ?? "").trim();
    rows.push({
      line,
      csi_code: csi,
      description: description || null,
      unit: unit || null,
      unit_cost: unitCost,
      labor_cost: splitReady ? labor : null,
      material_cost: splitReady ? material : null,
      equipment_cost: splitReady ? equipment : null,
      region_code: region || null,
      effective_from: dated.value,
    });
  }

  return { rows, rejected };
}
