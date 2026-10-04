import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { extractionFromPageText } from "@/lib/documents/extraction-fallback";
import { parseImage } from "./image.ts";
import { entitiesFromPageText, parsePdf } from "./pdf.ts";

describe("local PDF and image reads", () => {
  it("classifies a text PDF from the embedded words and does not call a model", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sentence = "SECTION 03 30 00 CAST-IN-PLACE CONCRETE specification scale 1/4\" = 1'-0\" contractor notes for the slab";
    page.drawText(sentence, { x: 48, y: 720, size: 12, font });
    const bytes = Buffer.from(await doc.save());

    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("model");
    }) as typeof fetch;
    try {
      const result = await parsePdf(bytes, { filename: "spec.pdf", mime: "application/pdf" }, {
        tenantId: "t",
        userId: "u",
      });
      assert.equal(called, false);
      assert.equal(result.kind, "text");
      if (result.kind !== "text") return;
      const extraction = extractionFromPageText(
        [{ pageNumber: 1, text: result.text ?? "" }],
        1,
      );
      assert.equal(extraction.doc_type, "spec");
      assert.ok(entitiesFromPageText([{ pageNumber: 1, text: result.text ?? "" }]).some((entity) => entity.type === "scale"));
    } finally {
      globalThis.fetch = original;
    }
  });

  it("asks for a PDF or DXF when the file is a photo", async () => {
    const result = await parseImage(Buffer.from("not-a-photo"), { filename: "site.jpg", mime: "image/jpeg" }, {
      tenantId: "t",
      userId: "u",
    });
    assert.equal(result.kind, "error");
    assert.match(result.error ?? "", /Upload a PDF or DXF/);
  });
});
