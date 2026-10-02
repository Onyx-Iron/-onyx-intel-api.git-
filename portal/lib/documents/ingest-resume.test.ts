import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pagesStillNeedingChunks } from "./ingest-resume.ts";

describe("ingest resume", () => {
  it("keeps only pages that do not already have chunks", () => {
    const remaining = pagesStillNeedingChunks(
      [
        { page_number: 1, summary: "cover" },
        { page_number: 2, summary: "plan" },
        { page_number: 3, summary: "detail" },
      ],
      [1, 2],
    );
    assert.deepEqual(remaining.map((page) => page.page_number), [3]);
  });

  it("returns every page when nothing has been chunked", () => {
    const remaining = pagesStillNeedingChunks([{ page_number: 4 }], []);
    assert.equal(remaining.length, 1);
  });
});
