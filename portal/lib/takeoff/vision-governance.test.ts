import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVisionSourceDescriptor, scopeRequestToJobScope } from "./vision-governance";

describe("vision source governance", () => {
  it("uses classified sheet identity so two disciplines with the same number cannot collide", () => {
    const source = buildVisionSourceDescriptor({
      documentId: "doc-1", pageId: "page-1", pageNumber: 7, checksum: "sha256:abc",
      sheet: { discipline: "A", sheetNumber: "101", revision: "3", revisionDate: "2026-08-01" },
    });
    assert.equal(source.sheetIdentity, "A:101");
    assert.equal(source.sheetNumber, "101");
    assert.equal(source.discipline, "A");
  });

  it("falls back to a stable document/page identity without inventing sheet metadata", () => {
    const source = buildVisionSourceDescriptor({ documentId: "doc-1", pageId: "page-1", pageNumber: 7, checksum: "abc", sheet: null });
    assert.equal(source.sheetIdentity, "DOCUMENT:doc-1:PAGE:7");
    assert.equal(source.sheetNumber, "PAGE-7");
    assert.equal(source.discipline, "UNCLASSIFIED");
    assert.equal(source.revisionLabel, null);
  });

  it("maps the confirmed preflight vocabulary into the canonical job contract and includes the active document", () => {
    const scope = scopeRequestToJobScope({
      mode: "selected_trades", division_codes: ["03", "26"], trade_keys: [], bid_package_ids: [],
      document_ids: [], sheet_ids: [], alternate_keys: [], confirmed_at: "2026-08-14T12:00:00.000Z", requested_by: "user-1",
    }, "doc-1", "user-1");
    assert.equal(scope.mode, "trades");
    assert.deepEqual(scope.tradeCodes, ["03", "26"]);
    assert.deepEqual(scope.documentIds, ["doc-1"]);
  });
});
