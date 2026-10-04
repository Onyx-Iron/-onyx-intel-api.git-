import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidePasswordAttempt,
  missingPageNumbers,
  pdfDeclaresEncryption,
  plainLanguageError,
  processingStage,
  quantitiesAllowedForDocType,
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

  it("measures an unclassified plan and a drawing, and blocks a spec or other", () => {
    assert.equal(quantitiesAllowedForDocType("drawing"), true);
    assert.equal(quantitiesAllowedForDocType(null), true);
    assert.equal(quantitiesAllowedForDocType(""), true);
    assert.equal(quantitiesAllowedForDocType("spec"), false);
    assert.equal(quantitiesAllowedForDocType("other"), false);
    assert.match(takeoffBlockReason({ status: "complete", doc_type: "spec" }) ?? "", /Only drawings/);
    assert.equal(takeoffBlockReason({ status: "complete", doc_type: null }), null);
    assert.equal(processingStage({ status: "processing", ocr_status: "done" }), "Indexing");
  });
});
