/**
 * Tiny CSV/TSV parser — no external dependency. Handles quoted fields,
 * embedded delimiters, escaped quotes (""), and CRLF/LF line endings.
 */
import type { ParseResult } from "./index";

type Row = Record<string, string | number | null>;

function splitCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // swallow — handled by \n
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // flush
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function coerce(s: string): string | number | null {
  if (s === "") return null;
  const trimmed = s.trim();
  if (trimmed === "") return s;
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^-?\d*\.\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

export async function parseCsv(
  bytes: Buffer,
  base: { filename: string; mime: string },
  delim: "," | "\t" = ",",
): Promise<ParseResult> {
  if (!bytes || bytes.length === 0) {
    return { kind: "error", ...base, error: "Empty CSV file." };
  }
  // Strip UTF-8 BOM if present (also handle UTF-16 LE BOM gracefully — decode as utf-16le).
  let text: string;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = bytes.toString("utf16le").replace(/^﻿/, "");
  } else {
    text = bytes.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  // Normalize lone-\r (legacy mac) to \n; CRLF/LF handled by splitCsv.
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const matrix = splitCsv(text, delim).filter((r) => r.some((c) => c !== ""));
  if (matrix.length === 0) {
    return { kind: "error", ...base, error: "CSV has no rows." };
  }

  // Belt-and-suspenders: strip BOM from the first cell if it survived decoding.
  if (matrix[0].length > 0 && matrix[0][0].charCodeAt(0) === 0xfeff) {
    matrix[0][0] = matrix[0][0].slice(1);
  }

  const rawHeaders = matrix[0].map((h, i) =>
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
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    const obj: Row = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = coerce(cells[c] ?? "");
    }
    rows.push(obj);
  }

  return { kind: "rows", ...base, headers, rows };
}
