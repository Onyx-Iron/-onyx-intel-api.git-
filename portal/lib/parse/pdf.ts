/**
 * PDF parser — reads the embedded text layer with pdf.js.
 * Digital sheets carry their own words, scales, and identifiers.
 */
import type { ParseResult, ParseContext, ParseEntity } from "./index";
import { extractionFromPageText, readPdfPageText, scaleStringFromText } from "@/lib/documents/extraction-fallback";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const CSI = /\b\d{2}[\s-]?\d{2}[\s-]?\d{2}\b/g;
const SHEET = /\b[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?\b/g;

function pushMatches(entities: ParseEntity[], text: string, page: number, type: string, re: RegExp): void {
  re.lastIndex = 0;
  const seen = new Set(entities.filter((e) => e.type === type && e.page === page).map((e) => e.value));
  for (const match of text.match(re) ?? []) {
    const value = match.replace(/\s+/g, " ").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    entities.push({ type, value, page, confidence: 1 });
  }
}

export function entitiesFromPageText(pages: Array<{ pageNumber: number; text: string }>): ParseEntity[] {
  const entities: ParseEntity[] = [];
  for (const page of pages) {
    const scale = scaleStringFromText(page.text);
    if (scale) entities.push({ type: "scale", value: scale, page: page.pageNumber, confidence: 1 });
    pushMatches(entities, page.text, page.pageNumber, "email", EMAIL);
    pushMatches(entities, page.text, page.pageNumber, "phone", PHONE);
    pushMatches(entities, page.text, page.pageNumber, "csi_section", CSI);
    pushMatches(entities, page.text, page.pageNumber, "sheet_number", SHEET);
  }
  return entities;
}

export async function parsePdf(
  bytes: Buffer,
  base: { filename: string; mime: string },
  _ctx: ParseContext,
): Promise<ParseResult> {
  try {
    const pages = await readPdfPageText(new Uint8Array(bytes));
    const extraction = extractionFromPageText(pages, pages.length);
    const text = pages.map((page) => page.text).filter(Boolean).join("\n");
    return {
      kind: "text",
      ...base,
      mime: "application/pdf",
      text: extraction.title ? `${extraction.title}\n${text}` : text,
      entities: entitiesFromPageText(pages),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", ...base, error: `Could not read PDF text: ${message}` };
  }
}
