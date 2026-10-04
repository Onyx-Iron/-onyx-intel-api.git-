import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chunkIds,
  selectPagesForReprocess,
  stagesToRun,
  type DocumentPageRow,
} from "./reprocessPage.ts";

const pages: DocumentPageRow[] = [
  { id: "a", page_number: 1, storage_path: "pages/d/page-1.pdf", status: "error", takeoff_status: "done" },
  { id: "b", page_number: 2, storage_path: "pages/d/page-2.pdf", status: "done", takeoff_status: "error" },
  { id: "c", page_number: 3, storage_path: "pages/d/page-3.pdf", status: "done", takeoff_status: "done" },
];

describe("reprocessPage helpers", () => {
  it("selects one page or all pages", () => {
    assert.equal(selectPagesForReprocess(pages, 2).length, 1);
    assert.equal(selectPagesForReprocess(pages, 2)[0]?.id, "b");
    assert.equal(selectPagesForReprocess(pages, null).length, 3);
    assert.equal(selectPagesForReprocess(pages, 99).length, 0);
  });

  it("maps stage to worker list", () => {
    assert.deepEqual(stagesToRun("ocr"), ["ocr"]);
    assert.deepEqual(stagesToRun("takeoff"), ["takeoff"]);
    assert.deepEqual(stagesToRun("both"), ["ocr", "takeoff"]);
  });

  it("chunks id filters so a large reprocess does not exceed the query string", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 100);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]?.length, 100);
    assert.equal(chunks[2]?.length, 50);
    assert.equal(chunks.flat().length, 250);
  });
});
