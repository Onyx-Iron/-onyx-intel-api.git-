import { calculateItem } from "./calculations";
import { lookupCsi, normalizeLineType, type EstimateLineType } from "./csi-catalog";

export interface ExportLine {
  description: string;
  csi_code?: string | null;
  cost_code?: string | null;
  item_type?: string | null;
  quantity?: number | null;
  uom?: string | null;
  unit_cost?: number | null;
  total_price?: number | null;
  pricing_status?: string | null;
  notes?: string | null;
  drawing_ref?: string | null;
  location_tag?: string | null;
  source_takeoff_id?: string | null;
  quantity_basis?: string | null;
}

export type EstimateGroupBy = "division" | "type" | "none";

export interface ExportGroup {
  key: string;
  label: string;
  lines: ExportLine[];
  subtotal: number;
}

export function isSourceRemoved(line: { notes?: string | null }): boolean {
  return (line.notes ?? "").startsWith("Source removed");
}

export function lineContributesToSellPrice(line: ExportLine): boolean {
  if (isSourceRemoved(line)) return false;
  if (line.pricing_status === "unpriced" || line.pricing_status === "review") return false;
  return typeof line.total_price === "number" && Number.isFinite(line.total_price);
}

/**
 * Rate used by a quantity × rate formula. Stored `total_price` already
 * includes contingency, overhead, and profit; `unit_cost` is only the
 * direct rate, so a formula built from it drops the markup.
 */
export function sellUnitRate(line: ExportLine): number | null {
  if (!lineContributesToSellPrice(line)) return null;
  const quantity = line.quantity;
  const total = line.total_price;
  if (typeof quantity === "number" && Number.isFinite(quantity) && quantity !== 0 && typeof total === "number" && Number.isFinite(total)) {
    return total / quantity;
  }
  return typeof line.unit_cost === "number" && Number.isFinite(line.unit_cost) ? line.unit_cost : null;
}

export function quantitySourceLabel(line: Pick<ExportLine, "notes" | "drawing_ref" | "location_tag" | "source_takeoff_id" | "pricing_status">): string {
  if (isSourceRemoved(line)) return "Source removed";
  if (line.drawing_ref && line.location_tag) return `${line.drawing_ref} / ${line.location_tag}`;
  if (line.drawing_ref) return line.drawing_ref;
  if (line.source_takeoff_id) return "Measurement";
  if (line.pricing_status === "manual" || !line.pricing_status) return "Manual entry";
  return "Catalog rate";
}

export function sellPrice(lines: ExportLine[]): number {
  const items = lines.filter(lineContributesToSellPrice).map((line) => ({
    totalDirectCost: line.total_price ?? 0,
    indirectCost: 0,
    contingency: 0,
    overhead: 0,
    profit: 0,
    totalPrice: line.total_price ?? 0,
    isAlternate: false,
    alternateAccepted: false,
  }));
  return items.reduce((sum, item) => sum + item.totalPrice, 0);
}

function groupKey(line: ExportLine, by: EstimateGroupBy): { key: string; label: string } {
  if (by === "type") {
    const type = normalizeLineType(line.item_type);
    return { key: type, label: type };
  }
  if (by === "none") return { key: "all", label: "All lines" };
  const code = line.csi_code || line.cost_code || "";
  const division = lookupCsi(code).division;
  const key = division?.code ?? "unassigned";
  const label = division ? `${division.code} ${division.name}` : "Unassigned";
  return { key, label };
}

export function groupEstimateLines(lines: ExportLine[], by: EstimateGroupBy): ExportGroup[] {
  const order: string[] = [];
  const groups = new Map<string, ExportGroup>();
  for (const line of lines) {
    const { key, label } = groupKey(line, by);
    let group = groups.get(key);
    if (!group) {
      group = { key, label, lines: [], subtotal: 0 };
      groups.set(key, group);
      order.push(key);
    }
    group.lines.push(line);
    if (lineContributesToSellPrice(line)) group.subtotal += line.total_price ?? 0;
  }
  return order.map((key) => groups.get(key)!);
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildEstimateCsv(lines: ExportLine[], by: EstimateGroupBy = "division"): string {
  const header = ["Division", "CSI", "Type", "Description", "Quantity", "Unit", "Rate", "Total", "Source", "Priced"];
  const rows = [header.join(",")];
  for (const group of groupEstimateLines(lines, by)) {
    for (const line of group.lines) {
      const priced = lineContributesToSellPrice(line);
      rows.push([
        csvCell(group.label),
        csvCell(line.csi_code || line.cost_code),
        csvCell(normalizeLineType(line.item_type)),
        csvCell(line.description),
        csvCell(line.quantity ?? ""),
        csvCell(line.uom),
        csvCell(priced ? sellUnitRate(line) ?? "" : ""),
        csvCell(priced ? line.total_price ?? "" : ""),
        csvCell(quantitySourceLabel(line)),
        csvCell(priced ? "yes" : "no"),
      ].join(","));
    }
  }
  return rows.join("\n");
}

export interface XlsxFormulaSheet {
  rows: (string | number | null)[][];
  /** 1-based row indexes whose Total cell is a formula Qty * Rate. */
  formulaRows: number[];
  subtotalRows: number[];
}

/**
 * Spreadsheet layout. Line totals are formulas (quantity * rate).
 * Group subtotals are SUM of the line-total cells in that group.
 * Unpriced and source-removed lines keep a blank rate so they cannot
 * enter the sell-price formulas.
 */
export function buildEstimateFormulaSheet(lines: ExportLine[], by: EstimateGroupBy = "division"): XlsxFormulaSheet {
  const rows: (string | number | null)[][] = [[
    "Division", "CSI", "Type", "Description", "Quantity", "Unit", "Rate", "Total", "Source",
  ]];
  const formulaRows: number[] = [];
  const subtotalRows: number[] = [];
  for (const group of groupEstimateLines(lines, by)) {
    const firstDataRow = rows.length + 1;
    for (const line of group.lines) {
      const rate = sellUnitRate(line);
      rows.push([
        group.label,
        line.csi_code || line.cost_code || "",
        normalizeLineType(line.item_type),
        line.description,
        line.quantity ?? 0,
        line.uom ?? "",
        rate,
        null,
        quantitySourceLabel(line),
      ]);
      if (rate != null) formulaRows.push(rows.length);
    }
    const lastDataRow = rows.length;
    rows.push([group.label, "", "", `${group.label} subtotal`, null, "", null, null, ""]);
    if (lastDataRow >= firstDataRow) subtotalRows.push(rows.length);
  }
  rows.push(["", "", "", "Sell price", null, "", null, null, ""]);
  return { rows, formulaRows, subtotalRows };
}

export function applyXlsxFormulas(
  sheet: { [cell: string]: { f?: string; v?: string | number | null; t?: string } },
  layout: XlsxFormulaSheet,
  encodeCell: (row: number, column: number) => string,
): void {
  for (const rowNumber of layout.formulaRows) {
    const cell = encodeCell(rowNumber - 1, 7);
    sheet[cell] = { f: `E${rowNumber}*G${rowNumber}`, t: "n" };
  }
  const subtotalAddresses: string[] = [];
  let cursor = 1;
  for (const rowNumber of layout.subtotalRows) {
    const start = cursor + 1;
    const end = rowNumber - 1;
    const cell = encodeCell(rowNumber - 1, 7);
    if (end >= start) {
      sheet[cell] = { f: `SUM(H${start}:H${end})`, t: "n" };
      subtotalAddresses.push(`H${rowNumber}`);
    }
    cursor = rowNumber;
  }
  const totalRow = layout.rows.length;
  const totalCell = encodeCell(totalRow - 1, 7);
  sheet[totalCell] = subtotalAddresses.length > 0
    ? { f: subtotalAddresses.join("+"), t: "n" }
    : { v: 0, t: "n" };
}

export async function buildEstimateXlsx(lines: ExportLine[], by: EstimateGroupBy = "division"): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const layout = buildEstimateFormulaSheet(lines, by);
  const sheet = XLSX.utils.aoa_to_sheet(layout.rows);
  applyXlsxFormulas(sheet as never, layout, (row, column) => XLSX.utils.encode_cell({ r: row, c: column }));
  sheet["!cols"] = [
    { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 24 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Estimate");
  const out = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}

export async function buildEstimatePdf(lines: ExportLine[], projectName: string, by: EstimateGroupBy = "division"): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const groups = groupEstimateLines(lines, by);
  let page = doc.addPage([792, 612]);
  let y = 580;
  const draw = (text: string, size = 10) => {
    if (y < 40) {
      page = doc.addPage([792, 612]);
      y = 580;
    }
    page.drawText(text.slice(0, 140), { x: 36, y, size, font });
    y -= size + 6;
  };
  draw(projectName || "Estimate", 16);
  draw(`Sell price ${sellPrice(lines).toFixed(2)}`, 12);
  for (const group of groups) {
    draw("");
    draw(`${group.label}  ${group.subtotal.toFixed(2)}`, 12);
    for (const line of group.lines) {
      const priced = lineContributesToSellPrice(line);
      const total = priced ? (line.total_price ?? 0).toFixed(2) : "unpriced";
      draw(`${line.csi_code || line.cost_code || ""}  ${line.description}  ${line.quantity ?? ""} ${line.uom ?? ""}  ${total}  ${quantitySourceLabel(line)}`);
    }
  }
  return doc.save();
}

/** Server check: a formula total matches calculateItem for a single priced line. */
export function formulaMatchesServer(quantity: number, unitCost: number): { formula: number; server: number } {
  const formula = Math.round((quantity * unitCost + Number.EPSILON) * 100) / 100;
  const server = calculateItem({
    materialCost: quantity * unitCost,
    quantity,
    indirectCost: 0,
    contingency: 0,
    overhead: 0,
    profit: 0,
  }).totalPrice;
  return { formula, server };
}

export function lineTypeOf(line: ExportLine): EstimateLineType {
  return normalizeLineType(line.item_type);
}
