import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChunkCitationLabel } from "./chunkMeta.ts";

describe("chunkMeta citation labels", () => {
  it("includes page, heading path, and parser", () => {
    assert.equal(
      formatChunkCitationLabel({
        pageNumber: 3,
        meta: { parser_id: "docling", heading_path: ["Division 09", "Flooring"], confidence: 0.9, bbox: null, source: "page-processor" },
      }),
      "page 3 › Division 09 › Flooring · docling",
    );
  });

  it("falls back to page only", () => {
    assert.equal(formatChunkCitationLabel({ pageNumber: 1, meta: null }), "page 1");
  });
});
