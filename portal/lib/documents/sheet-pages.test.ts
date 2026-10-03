import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { looksLikePdf, publishSheetPages, splitPdfIntoPages, type SheetPageStore } from "./sheet-pages.ts";

async function twoPagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 100]);
  pdf.addPage([200, 100]);
  return pdf.save();
}

describe("sheet pages", () => {
  it("recognizes pdf names and content types", () => {
    assert.equal(looksLikePdf("Plan Set.PDF", null), true);
    assert.equal(looksLikePdf("notes.bin", "application/pdf"), true);
    assert.equal(looksLikePdf("specs.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), false);
  });

  it("splits a multi-page pdf into one file per sheet", async () => {
    const pages = await splitPdfIntoPages(await twoPagePdf());
    assert.equal(pages.length, 2);
    for (const bytes of pages) {
      const doc = await PDFDocument.load(bytes);
      assert.equal(doc.getPageCount(), 1);
    }
  });

  it("publishes a page row for each sheet and skips a complete set", async () => {
    const uploaded: string[] = [];
    let existing = 0;
    const store: SheetPageStore = {
      async countExisting() { return existing; },
      async uploadPage(path) { uploaded.push(path); },
      async insertPages(rows) { existing = rows.length; },
    };
    const bytes = await twoPagePdf();
    const created = await publishSheetPages(store, {
      tenantId: "tenant-1",
      documentId: "doc-1",
      pdfBytes: bytes,
    });
    assert.equal(created.pageCount, 2);
    assert.equal(created.created.length, 2);
    assert.equal(created.created[0].page_number, 1);
    assert.deepEqual(uploaded, ["pages/doc-1/page-1.pdf", "pages/doc-1/page-2.pdf"]);

    uploaded.length = 0;
    const again = await publishSheetPages(store, {
      tenantId: "tenant-1",
      documentId: "doc-1",
      pdfBytes: bytes,
    });
    assert.equal(again.pageCount, 2);
    assert.equal(again.created.length, 0);
    assert.equal(uploaded.length, 0);
  });
});
