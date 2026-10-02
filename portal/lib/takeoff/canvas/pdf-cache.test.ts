import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cachedPdfDocument, clearPdfDocumentCache } from "./pdf-cache.ts";

describe("pdf document cache", () => {
  it("loads each url once and drops a rejected promise", async () => {
    clearPdfDocumentCache();
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.resolve({ page: 1 });
    };

    const first = await cachedPdfDocument("sheet-a.pdf", load);
    const second = await cachedPdfDocument("sheet-a.pdf", load);
    await cachedPdfDocument("sheet-b.pdf", load);

    assert.equal(first, second);
    assert.equal(loads, 2);

    let failures = 0;
    const fail = () => {
      failures += 1;
      return Promise.reject(new Error("parse failed"));
    };
    await assert.rejects(() => cachedPdfDocument("bad.pdf", fail));
    await assert.rejects(() => cachedPdfDocument("bad.pdf", fail));
    assert.equal(failures, 2);
  });
});
