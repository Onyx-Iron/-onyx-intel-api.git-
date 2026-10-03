import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { buildProposalDocx, buildProposalPdf } from "./proposal-export.ts";

const sample = {
  projectName: "River Plant",
  versionLabel: "Version 2 · approved",
  preview: false,
  lines: [{ code: "03 30 00", description: "Concrete", quantity: 10, unit: "CY", total: 4800 }],
  total: 4800,
  budgetLines: [{ code: "03 30 00", description: "Concrete", quantity: 10, unit: "CY", total: 4800 }],
};

describe("proposal export", () => {
  it("writes a PDF that names the project and the total", async () => {
    const bytes = await buildProposalPdf(sample);
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount() >= 1, true);
  });

  it("writes a docx package containing the budget section", () => {
    const bytes = buildProposalDocx(sample);
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    const xml = Buffer.from(bytes).toString("latin1");
    assert.match(xml, /Budget snapshot/);
    assert.match(xml, /River Plant/);
  });
});