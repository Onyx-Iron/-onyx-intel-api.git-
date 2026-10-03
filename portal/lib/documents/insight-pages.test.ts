import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeInsightPages } from "./insight-pages.ts";

describe("mergeInsightPages", () => {
  it("keeps a structured summary and fills missing pages from splitter OCR", () => {
    const pages = mergeInsightPages(
      [{ page_number: 1, extracted_text: "Cover sheet\nKey terms: title, index" }],
      [
        { page_number: 1, ocr_text: "raw cover text that should not replace the summary" },
        { page_number: 2, ocr_text: "A2.01 floor plan" },
      ],
    );
    assert.deepEqual(pages, [
      { page_number: 1, summary: "Cover sheet", key_terms: ["title", "index"] },
      { page_number: 2, summary: "A2.01 floor plan", key_terms: [] },
    ]);
  });

  it("returns splitter text when the synchronous ingest never wrote pages", () => {
    const pages = mergeInsightPages([], [{ page_number: 3, ocr_text: "detail sheet" }]);
    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.page_number, 3);
    assert.equal(pages[0]?.summary, "detail sheet");
  });
});
