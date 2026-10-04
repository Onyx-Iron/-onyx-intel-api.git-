/**
 * When the model extraction is missing, empty, or not JSON, page text already
 * in the PDF is the alternate. Scanned pages with no text stay missing.
 * Neither path invents a quantity.
 */

export interface ExtractedPage {
  page_number: number;
  summary: string;
  key_terms: string[];
}

export interface DocumentExtraction {
  doc_type: string;
  page_count: number;
  title: string;
  pages: ExtractedPage[];
}

export interface LocalPageText {
  pageNumber: number;
  text: string;
}

const STOP = new Set([
  "this", "that", "with", "from", "have", "sheet", "page", "plan", "drawing",
  "section", "shall", "contractor", "shown", "note", "notes", "typical",
]);

export function parseModelJson(raw: string): DocumentExtraction | null {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as Partial<DocumentExtraction>;
    if (!parsed || typeof parsed !== "object") return null;
    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    return {
      doc_type: typeof parsed.doc_type === "string" ? parsed.doc_type : "other",
      page_count: typeof parsed.page_count === "number" ? parsed.page_count : pages.length,
      title: typeof parsed.title === "string" ? parsed.title : "",
      pages: pages.flatMap((page) => {
        const pageNumber = Number((page as ExtractedPage).page_number);
        if (!Number.isInteger(pageNumber) || pageNumber < 1) return [];
        const summary = typeof (page as ExtractedPage).summary === "string" ? (page as ExtractedPage).summary.trim() : "";
        const keyTerms = Array.isArray((page as ExtractedPage).key_terms)
          ? (page as ExtractedPage).key_terms.filter((term) => typeof term === "string" && term.trim()).map((term) => term.trim())
          : [];
        return [{ page_number: pageNumber, summary, key_terms: keyTerms }];
      }),
    };
  } catch {
    return null;
  }
}

const SCALE_TEXT = /(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*"?\s*=\s*\d+\s*'\s*(?:-\s*\d+\s*"?)?/;

/** A title-block scale is readable even when the rest of the page text is short. */
export function scaleStringFromText(text: string): string | null {
  const match = text.match(SCALE_TEXT);
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

export function extractionFromPageText(pages: LocalPageText[], pdfPageCount: number): DocumentExtraction {
  const usable = pages.filter((page) => page.text.trim().length >= 40 || scaleStringFromText(page.text));
  const joined = usable.map((page) => page.text).join(" ").slice(0, 4000);
  return {
    doc_type: classifyLocalText(joined),
    page_count: pdfPageCount,
    title: titleFromText(usable[0]?.text ?? ""),
    pages: usable.map((page) => ({
      page_number: page.pageNumber,
      summary: page.text.replace(/\s+/g, " ").trim().slice(0, 500),
      key_terms: [...new Set([scaleStringFromText(page.text), ...keyTerms(page.text)].filter((term): term is string => Boolean(term)))],
    })),
  };
}

/**
 * Model pages with a summary win. Empty or absent model pages are filled
 * from local text. Pages neither path could read stay out of the list.
 */
export function mergeExtractions(
  model: DocumentExtraction | null,
  local: DocumentExtraction | null,
  pdfPageCount: number,
): { extraction: DocumentExtraction; alternatePages: number[] } {
  const byNumber = new Map<number, ExtractedPage>();
  const alternatePages: number[] = [];
  for (const page of model?.pages ?? []) {
    if (page.summary.trim()) byNumber.set(page.page_number, page);
  }
  for (const page of local?.pages ?? []) {
    const current = byNumber.get(page.page_number);
    if (current?.summary.trim()) continue;
    if (!page.summary.trim()) continue;
    byNumber.set(page.page_number, page);
    alternatePages.push(page.page_number);
  }
  const pages = [...byNumber.values()].sort((a, b) => a.page_number - b.page_number);
  return {
    extraction: {
      doc_type: model?.doc_type && model.doc_type !== "other" ? model.doc_type : (local?.doc_type || model?.doc_type || "other"),
      page_count: pdfPageCount > 0 ? pdfPageCount : (model?.page_count ?? pages.length),
      title: model?.title?.trim() || local?.title || "",
      pages,
    },
    alternatePages,
  };
}

function classifyLocalText(text: string): string {
  const sample = text.toUpperCase();
  if (/SECTION\s+\d{2}\s*\d{2}\s*\d{2}/.test(sample) || /\bSPECIFICATION\b/.test(sample)) return "spec";
  if (/\bREQUEST FOR INFORMATION\b|\bRFI\b/.test(sample)) return "rfi";
  if (/\bSUBMITTAL\b/.test(sample)) return "submittal";
  if (/\b(SHEET|FLOOR PLAN|SITE PLAN|ELEVATION|DETAIL)\b/.test(sample)) return "drawing";
  if (/\b(AGREEMENT|GENERAL CONDITIONS)\b/.test(sample)) return "contract";
  // A plan sheet with no title-block words is still a drawing. "other"
  // would block quantities on the engineering PDF that was uploaded.
  return "drawing";
}

function titleFromText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim().slice(0, 120);
  return line;
}

function keyTerms(text: string): string[] {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (STOP.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([word]) => word);
}

export async function readPdfPageText(bytes: Uint8Array): Promise<LocalPageText[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as {
    getDocument: (src: Record<string, unknown>) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
        destroy: () => Promise<void>;
      }>;
    };
  };
  const doc = await pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
  }).promise;
  const pages: LocalPageText[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str ?? "").join(" ").replace(/\s+/g, " ").trim();
      pages.push({ pageNumber, text });
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return pages;
}
