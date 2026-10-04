import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rankStoredPageText, selectOcrContext, textFromPdfTextItems } from "./page-text.ts";

describe("textFromPdfTextItems", () => {
  it("joins embedded strings and drops empty items", () => {
    assert.equal(
      textFromPdfTextItems([{ str: "FOOTING" }, null, { str: "  F1  " }, {}]),
      "FOOTING F1",
    );
  });
});

describe("selectOcrContext", () => {
  it("keeps every page when the stored text fits", () => {
    const context = selectOcrContext([
      { page_number: 2, text: "north footing" },
      { page_number: 1, text: "site plan" },
    ], "footing");
    assert.match(context, /Page 1[\s\S]*Page 2/);
    assert.match(context, /north footing/);
  });

  it("keeps the page that shares the question when the set is too long", () => {
    const context = selectOcrContext([
      { page_number: 1, text: "x".repeat(80) },
      { page_number: 2, text: `footing schedule ${"y".repeat(80)}` },
    ], "footing", 120);
    assert.match(context, /Page 2/);
    assert.match(context, /footing schedule/);
    assert.doesNotMatch(context, /Page 1/);
  });
});

describe("rankStoredPageText", () => {
  it("returns the sheet that contains the query and skips the rest", () => {
    const matches = rankStoredPageText([
      { document_id: "doc-a", page_number: 1, text: "general notes" },
      { document_id: "doc-a", page_number: 4, text: "spread footing F1 is 3 feet square" },
    ], "footing size", 3);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.page_number, 4);
    assert.match(matches[0]?.content ?? "", /spread footing/);
    assert.ok((matches[0]?.rrf_score ?? 0) > 0.01);
  });
});
