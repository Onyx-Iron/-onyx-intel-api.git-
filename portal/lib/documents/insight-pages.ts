export interface InsightPage {
  page_number: number;
  summary: string;
  key_terms: string[];
}

const OCR_SUMMARY_CHARS = 1200;

function fromExtractedText(text: string): Pick<InsightPage, "summary" | "key_terms"> {
  const [summary, keyTermsLine] = text.split("\n");
  const keyTerms = keyTermsLine
    ? keyTermsLine.replace(/^Key terms:\s*/i, "").split(",").map((term) => term.trim()).filter(Boolean)
    : [];
  return { summary: summary ?? "", key_terms: keyTerms };
}

/**
 * Insights prefer the structured page summary. Sheets the splitter already
 * OCRed fill any page that summary does not cover.
 */
export function mergeInsightPages(
  extracted: Array<{ page_number: number | null; extracted_text: string | null }>,
  ocr: Array<{ page_number: number | null; ocr_text: string | null }>,
): InsightPage[] {
  const byPage = new Map<number, InsightPage>();
  for (const row of extracted) {
    if (typeof row.page_number !== "number") continue;
    const text = row.extracted_text ?? "";
    if (!text.trim()) continue;
    byPage.set(row.page_number, { page_number: row.page_number, ...fromExtractedText(text) });
  }
  for (const row of ocr) {
    if (typeof row.page_number !== "number" || byPage.has(row.page_number)) continue;
    const text = (row.ocr_text ?? "").trim();
    if (!text) continue;
    byPage.set(row.page_number, {
      page_number: row.page_number,
      summary: text.slice(0, OCR_SUMMARY_CHARS),
      key_terms: [],
    });
  }
  return [...byPage.values()].sort((a, b) => a.page_number - b.page_number);
}
