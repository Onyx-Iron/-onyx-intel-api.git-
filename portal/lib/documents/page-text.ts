/** Embedded PDF text items from pdf.js `getTextContent()`. */
export function textFromPdfTextItems(items: Array<{ str?: string } | null | undefined>): string {
  return items
    .map((item) => (item && typeof item.str === "string" ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const OCR_CONTEXT_MAX_CHARS = 24_000;

export interface PageText {
  page_number: number;
  text: string;
}

function queryTerms(question: string): string[] {
  return [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
}

function pageBlock(pageNumber: number, text: string): string {
  return `=== Page ${pageNumber} ===\n${text}`;
}

/**
 * Full stored page text when it fits. A larger plan keeps the pages that
 * share words with the question so Q&A does not resend the whole set.
 */
export function selectOcrContext(pages: PageText[], question: string, maxChars = OCR_CONTEXT_MAX_CHARS): string {
  const usable = pages
    .map((page) => ({ page_number: page.page_number, text: page.text.replace(/\s+/g, " ").trim() }))
    .filter((page) => page.text.length > 0)
    .sort((a, b) => a.page_number - b.page_number);
  if (usable.length === 0) return "";

  const full = usable.map((page) => pageBlock(page.page_number, page.text)).join("\n\n");
  if (full.length <= maxChars) return full;

  const terms = queryTerms(question);
  const ranked = usable
    .map((page) => {
      const hay = page.text.toLowerCase();
      const hits = terms.reduce((count, term) => count + (hay.includes(term) ? 1 : 0), 0);
      return { ...page, hits };
    })
    .sort((a, b) => b.hits - a.hits || a.page_number - b.page_number);

  const parts: string[] = [];
  let used = 0;
  for (const page of ranked) {
    const header = `=== Page ${page.page_number} ===\n`;
    const room = maxChars - used - header.length;
    if (room <= 0) break;
    parts.push(`${header}${page.text.slice(0, room)}`);
    used += header.length + Math.min(page.text.length, room) + 2;
  }
  return parts.join("\n\n");
}

export interface StoredPageMatch {
  content: string;
  document_id: string;
  page_number: number;
  similarity: number;
  rrf_score: number;
}

/**
 * Rank pages that have no embedding. A page is returned only when it
 * contains a query term, so an empty sheet is not treated as a match.
 */
export function rankStoredPageText(
  pages: Array<{ document_id: string; page_number: number; text: string }>,
  query: string,
  limit: number,
): StoredPageMatch[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || limit <= 0) return [];

  const scored: StoredPageMatch[] = [];
  for (const page of pages) {
    const text = page.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const hay = text.toLowerCase();
    let hits = 0;
    let first = -1;
    for (const term of terms) {
      const at = hay.indexOf(term);
      if (at < 0) continue;
      hits += 1;
      if (first < 0 || at < first) first = at;
    }
    if (hits === 0) continue;
    const start = Math.max(0, first - 80);
    const similarity = hits / terms.length;
    scored.push({
      content: text.slice(start, start + 1200).trim(),
      document_id: page.document_id,
      page_number: page.page_number,
      similarity,
      rrf_score: similarity,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity || a.page_number - b.page_number);
  return scored.slice(0, limit);
}
