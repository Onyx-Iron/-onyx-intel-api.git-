import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { extractionFromPageText, mergeExtractions, parseModelJson, readPdfPageText, scaleStringFromText } from "./extraction-fallback.ts";

describe("extraction fallback", () => {
  it("reads model JSON wrapped in a fence and fills pages the model skipped", () => {
    const model = parseModelJson("```json\n{\"doc_type\":\"drawing\",\"page_count\":2,\"title\":\"Site\",\"pages\":[{\"page_number\":1,\"summary\":\"Sheet C1 site plan\",\"key_terms\":[\"grading\"]}]}\n```");
    assert.equal(model?.pages.length, 1);
    const local = extractionFromPageText([
      { pageNumber: 1, text: "ignored because the model already summarized this sheet with enough words here" },
      { pageNumber: 2, text: "SECTION 31 23 00 excavation and fill for the utility trench along the east property line" },
    ], 2);
    const merged = mergeExtractions(model, local, 2);
    assert.deepEqual(merged.alternatePages, [2]);
    assert.equal(merged.extraction.pages.length, 2);
    assert.equal(merged.extraction.doc_type, "drawing");
    assert.match(merged.extraction.pages[1]?.summary ?? "", /31 23 00/);
  });

  it("reads embedded PDF text when the model returns nothing", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("SHEET C-101 SITE PLAN grading and drainage for the east lot", { x: 48, y: 720, size: 12, font });
    const pages = await readPdfPageText(await pdf.save());
    const extraction = extractionFromPageText(pages, 1);
    assert.equal(extraction.doc_type, "drawing");
    assert.equal(extraction.pages.length, 1);
  });

  it("reads a scale string from a short title block", () => {
    assert.equal(scaleStringFromText('1/4" = 1\'-0"'), '1/4" = 1\'-0"');
    assert.match(scaleStringFromText('1" = 20\'') ?? "", /20/);
    const extraction = extractionFromPageText([{ pageNumber: 1, text: '1" = 20\'' }], 1);
    assert.equal(extraction.doc_type, "drawing");
    assert.equal(extraction.pages.length, 1);
    assert.match(extraction.pages[0]?.key_terms.join(" ") ?? "", /20/);
  });
});