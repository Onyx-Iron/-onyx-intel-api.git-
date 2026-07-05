/**
 * Universal file parser — dispatches an uploaded file to the right parser
 * based on extension/MIME and returns a normalized ParseResult.
 *
 * Each parser lives in its own file and is wrapped in try/catch here so a
 * parser failure produces `{ kind: "error", error }` instead of throwing.
 */

import { parseXlsx } from "./xlsx";
import { parseDocx } from "./docx";
import { parseCsv } from "./csv";
import { parseImage } from "./image";
import { parsePdf } from "./pdf";
import { parseCad } from "./cad";

export type ParseHint =
  | "takeoff"
  | "estimate"
  | "vendors"
  | "invoices"
  | "punch"
  | "contacts"
  | "docs";

export interface ParseEntity {
  type: string;
  value: string;
  page?: number;
  confidence?: number;
}

export interface ParseCadSummary {
  layers?: string[];
  entityCount?: number;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface ParseResult {
  kind: "rows" | "text" | "image" | "cad" | "error";
  filename: string;
  mime: string;
  rows?: Array<Record<string, string | number | null>>;
  headers?: string[];
  text?: string;
  entities?: ParseEntity[];
  cad?: ParseCadSummary;
  error?: string;
}

export interface ParseContext {
  tenantId: string;
  userId: string;
  hint?: ParseHint;
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

const TABULAR = new Set(["xlsx", "xls", "xlsm"]);
const IMAGE = new Set(["tiff", "tif", "png", "jpg", "jpeg", "webp", "gif", "bmp"]);
const CAD = new Set(["dwg", "dxf", "ifc"]);

export function isSupported(filename: string): boolean {
  const ext = extOf(filename);
  return (
    TABULAR.has(ext) ||
    IMAGE.has(ext) ||
    CAD.has(ext) ||
    ext === "csv" ||
    ext === "tsv" ||
    ext === "docx" ||
    ext === "pdf"
  );
}

/**
 * Sniff magic bytes to detect files that lie about their extension
 * (e.g. .png renamed to .pdf). Returns the true ext if recognized.
 */
function sniffMagic(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;
  // PDF: %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  // BMP
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  // TIFF (II or MM)
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)) return "tif";
  // ZIP (xlsx/docx). Caller decides which.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) return "zip";
  return null;
}

export async function parseFile(
  filename: string,
  mime: string,
  bytes: Buffer,
  ctx: ParseContext,
): Promise<ParseResult> {
  const ext = extOf(filename);
  const base = { filename, mime } as const;

  if (!bytes || bytes.length === 0) {
    return { kind: "error", filename, mime, error: "File is empty (0 bytes)." };
  }

  // Magic-byte sniff: catch files that lie about their extension.
  const magic = sniffMagic(bytes);
  if (magic && magic !== "zip") {
    const claimsImageOrPdf = IMAGE.has(ext) || ext === "pdf";
    const magicIsImageOrPdf = magic === "pdf" || ["png", "jpg", "gif", "bmp", "tif"].includes(magic);
    if (claimsImageOrPdf && magicIsImageOrPdf) {
      // Coerce to the magic-detected ext so the right parser runs.
      // This lets a real PNG renamed to .pdf still parse instead of crashing inside the PDF parser.
      const effectiveExt = magic === "tif" ? "tiff" : magic;
      return await dispatchByExt(effectiveExt, bytes, base, ctx, mime);
    }
  }

  return await dispatchByExt(ext, bytes, base, ctx, mime);
}

async function dispatchByExt(
  ext: string,
  bytes: Buffer,
  base: { filename: string; mime: string },
  ctx: ParseContext,
  mime: string,
): Promise<ParseResult> {
  const filename = base.filename;
  try {
    if (TABULAR.has(ext)) return await parseXlsx(bytes, base);
    if (ext === "csv" || ext === "tsv") {
      return await parseCsv(bytes, base, ext === "tsv" ? "\t" : ",");
    }
    if (ext === "docx") return await parseDocx(bytes, base);
    if (ext === "pdf") return await parsePdf(bytes, base, ctx);
    if (IMAGE.has(ext)) return await parseImage(bytes, base, ctx);
    if (CAD.has(ext)) return await parseCad(bytes, base, ctx);

    return {
      kind: "error",
      filename,
      mime,
      error: `Unsupported file type: .${ext || "(none)"}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", filename, mime, error: `Could not parse file: ${msg}` };
  }
}
