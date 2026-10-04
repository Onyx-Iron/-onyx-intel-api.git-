import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { missingPageNumbers, takeoffBlockReason } from "../documents/processing-display.ts";
import { buildEstimateImportRows } from "./takeoff-import.ts";
import { formulaMatchesServer } from "./estimate-export.ts";

describe("upload to estimate gate", () => {
  it("blocks takeoff while a page is failed, then prices only the approved measurement", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const bytes = await pdf.save();
    assert.ok(bytes.byteLength > 0);

    const pageCount = 2;
    const parsedPages = [1];
    const missing = missingPageNumbers(pageCount, parsedPages);
    assert.deepEqual(missing, [2]);

    const partial = {
      status: "complete_with_errors",
      doc_type: "drawing",
      page_count: pageCount,
      meta: { processing_summary: { missing_page_numbers: missing } },
    };
    assert.match(takeoffBlockReason(partial) ?? "", /Missing pages: 2/);

    const retried = {
      status: "complete",
      doc_type: "drawing",
      page_count: pageCount,
      meta: { processing_summary: { missing_page_numbers: [] } },
    };
    assert.equal(takeoffBlockReason(retried), null);

    const quantity = 48;
    const unitCost = 12.5;
    const imported = buildEstimateImportRows({
      projectId: "project-1",
      existingEstimateItems: [],
      costCatalog: [{ csi_code: "03-30-00", uom: "LF", unit_cost: unitCost }],
      takeoffItems: [
        {
          id: "ai-open",
          label: "Unapproved AI length",
          quantity: 999,
          unit: "LF",
          review_status: "suggested",
          meta: { extraction_method: "ai_vision" },
        },
        {
          id: "wall-1",
          label: "Approved wall",
          csi_code: "03-30-00",
          quantity,
          unit: "LF",
          review_status: "approved",
          meta: { extraction_method: "ai_vision" },
        },
      ],
    });
    assert.equal(imported.rows.length, 1);
    assert.equal(imported.rows[0].quantity, quantity);
    assert.equal(imported.blockedByReview, 1);
    const check = formulaMatchesServer(imported.rows[0].quantity ?? 0, unitCost);
    assert.equal(check.formula, check.server);
  });
});
