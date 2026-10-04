import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { measurePdfBytes } from "./measure-pdf.ts";

describe("measure a printed sheet", () => {
  it("reads the scale off the page and measures the line in feet", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('SCALE: 1" = 20\'', { x: 72, y: 72, size: 12, font, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: 100, y: 400 }, end: { x: 244, y: 400 }, thickness: 1, color: rgb(0, 0, 0) });
    const bytes = await pdf.save();
    const [measured] = await measurePdfBytes(bytes);
    assert.match(measured.text, /1" = 20'/);
    assert.equal(measured.regions.length, 1);
    const line = measured.rows.find((row) => row.kind === "length" && Math.abs((row.quantity ?? 0) - 40) < 0.05);
    assert.ok(line, `expected a 40 ft line, got ${measured.rows.map((row) => row.quantity).join(",")}`);
  });
});
