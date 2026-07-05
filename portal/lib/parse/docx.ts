/**
 * DOCX parser via `mammoth`. Extracts HTML, then:
 *  - if the document contains tables, returns the first table as rows[]
 *  - otherwise returns the plain text body
 */
import mammoth from "mammoth";
import type { ParseResult } from "./index";

type Row = Record<string, string | number | null>;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractFirstTable(html: string): string[][] | null {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const tableHtml = tableMatch[0];
  const rows: string[][] = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rm[0])) !== null) {
      const inner = cm[1].replace(/<[^>]+>/g, "").trim();
      cells.push(decodeEntities(inner));
    }
    if (cells.length) rows.push(cells);
  }
  return rows.length ? rows : null;
}

export async function parseDocx(
  bytes: Buffer,
  base: { filename: string; mime: string },
): Promise<ParseResult> {
  if (!bytes || bytes.length === 0) {
    return { kind: "error", ...base, error: "Empty DOCX file." };
  }
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: bytes })).value;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", ...base, error: `Could not open DOCX: ${msg}` };
  }
  const tableRows = extractFirstTable(html);

  if (tableRows && tableRows.length >= 2) {
    const rawHeaders = tableRows[0].map((h, i) =>
      h.trim() === "" ? `col_${i + 1}` : h.trim(),
    );
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
    for (let r = 1; r < tableRows.length; r++) {
      const obj: Row = {};
      for (let c = 0; c < headers.length; c++) {
        const v = tableRows[r][c] ?? "";
        obj[headers[c]] = v === "" ? null : v;
      }
      rows.push(obj);
    }
    return { kind: "rows", ...base, headers, rows };
  }

  const raw = (await mammoth.extractRawText({ buffer: bytes })).value;
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: "error", ...base, error: "DOCX contains no readable text." };
  }
  return { kind: "text", ...base, text: trimmed };
}
