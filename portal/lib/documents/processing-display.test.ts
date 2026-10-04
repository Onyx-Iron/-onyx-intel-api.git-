import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidePasswordAttempt,
  missingPageNumbers,
  pdfDeclaresEncryption,
  plainLanguageError,
  processingStage,
  quantitiesAllowedForDocType,
  sheetMeasureNote,
  takeoffBlockReason,
} from "./processing-display.ts";

describe("processing display", () => {
  it("names the pages a short parse is missing", () => {
    assert.deepEqual(missingPageNumbers(4, [1, 3]), [2, 4]);
    assert.deepEqual(missingPageNumbers(0, [1]), []);
  });

  it("maps encrypted PDFs to a password prompt instead of a corrupt-file message", () => {
    const encrypted = Buffer.from("header /Encrypt 12 0 R trailer");
    assert.equal(pdfDeclaresEncryption(encrypted), true);
    const required = decidePasswordAttempt({
      declaresEncryption: true,
      passwordProvided: false,
      opened: false,
      savedBytes: null,
    });
    assert.equal(required.ok, false);
    if (!required.ok) {
      assert.equal(required.code, "password_required");
      assert.match(plainLanguageError(required.message) ?? "", /password-protected/i);
      assert.doesNotMatch(plainLanguageError(required.message) ?? "", /corrupt/i);
    }
    const rejected = decidePasswordAttempt({
      declaresEncryption: true,
      passwordProvided: true,
      opened: false,
      savedBytes: null,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, "password_rejected");
  });

  it("blocks takeoff on a partial drawing until the missing pages are named and dismissed", () => {
    const doc = {
      status: "complete_with_errors",
      doc_type: "drawing",
      meta: { processing_summary: { missing_page_numbers: [2] } },
    };
    const blocked = takeoffBlockReason(doc);
    assert.match(blocked ?? "", /Missing pages: 2/);
    assert.equal(takeoffBlockReason({ ...doc, meta: { ...doc.meta, partial_acknowledged: true } }), null);
  });

  it("keeps manual measuring open while automatic quantities are still running", () => {
    const splitting = { status: "split", split_status: "pending", doc_type: "drawing" };
    assert.match(sheetMeasureNote(splitting) ?? "", /You can measure this sheet now/);
    assert.equal(sheetMeasureNote({ status: "complete", doc_type: "drawing" }), null);
    assert.equal(sheetMeasureNote({ status: "queued", doc_type: "spec" }), null);
  });

  it("leaves Splitting once the split has finished", () => {
    assert.notEqual(processingStage({ status: "split", split_status: "done" }), "Splitting");
    assert.equal(processingStage({ status: "split", split_status: "done" }), "Reading pages");
    assert.equal(processingStage({ status: "queued", split_status: "pending" }), "Splitting");
    const blocked = takeoffBlockReason({ status: "split", split_status: "done", doc_type: "drawing" });
    assert.match(blocked ?? "", /reading pages/i);
    assert.doesNotMatch(blocked ?? "", /splitting/i);
  });

  it("does not emit quantities from a spec, an unclassified file, or other", () => {
    assert.equal(quantitiesAllowedForDocType("spec"), false);
    assert.equal(quantitiesAllowedForDocType(null), false);
    assert.equal(quantitiesAllowedForDocType("other"), false);
    assert.match(takeoffBlockReason({ status: "complete", doc_type: "spec" }) ?? "", /Only drawings/);
    assert.equal(processingStage({ status: "processing", ocr_status: "done" }), "Indexing");
  });
});
