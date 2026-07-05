/**
 * XLSX/XLS parser via SheetJS (`xlsx`). Reads the first non-empty sheet,
 * uses row 1 as headers (falling back to `col_N`) and returns rows[].
 */
import * as XLSX from "xlsx";
import type { ParseResult } from "./index";

type Row = Record<string, string | number | null>;

export async function parseXlsx(
  bytes: Buffer,
  base: { filename: string; mime: string },
): Promise<ParseResult> {
  if (!bytes || bytes.length === 0) {
    return { kind: "error", ...base, error: "Empty spreadsheet file." };
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "buffer" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", ...base, error: `Could not open spreadsheet: ${msg}` };
  }
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return { kind: "error", ...base, error: "Spreadsheet contains no sheets." };
  }
  const firstName = wb.SheetNames.find((n) => {
    const ws = wb.Sheets[n];
    return ws && Object.keys(ws).some((k) => !k.startsWith("!"));
  }) ?? wb.SheetNames[0];

  if (!firstName) {
    return { kind: "error", ...base, error: "Spreadsheet has no non-empty sheet." };
  }
  const ws = wb.Sheets[firstName];
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | null>>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });

  if (matrix.length === 0) {
    return { kind: "error", ...base, error: "Spreadsheet has no rows." };
  }

  // Strip UTF-8 BOM that sometimes appears in the first cell when xlsx is converted from csv.
  const rawHeaders = (matrix[0] ?? []).map((h, i) => {
    if (h == null) return `col_${i + 1}`;
    let s = String(h);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    s = s.trim();
    return s === "" ? `col_${i + 1}` : s;
  });
  // De-duplicate headers — guard against collision with already-claimed names
  // (e.g. real "foo_2" exists AND a second "foo" gets suffixed to "foo_2").
  const claimed = new Set<string>();
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    if (n === 0 && !claimed.has(h)) { claimed.add(h); return h; }
    let candidate = `${h}_${n + 1}`;
    let extra = n + 1;
    while (claimed.has(candidate)) { extra++; candidate = `${h}_${extra}`; }
    claimed.add(candidate);
    return candidate;
  });

  const rows: Row[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const obj: Row = {};
    let anyVal = false;
    for (let c = 0; c < headers.length; c++) {
      const v = row[c];
      if (v !== null && v !== undefined && v !== "") anyVal = true;
      obj[headers[c]] = (v as string | number | null) ?? null;
    }
    if (anyVal) rows.push(obj);
  }

  return { kind: "rows", ...base, headers, rows };
}
