import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clearPageVectorScanCache, markPageVectorScanDone, pageVectorScanDone } from "./vector-scan-cache.ts";

describe("page vector scan cache", () => {
  it("remembers a page until the cache is cleared", () => {
    clearPageVectorScanCache();
    assert.equal(pageVectorScanDone("page-1"), false);
    markPageVectorScanDone("page-1");
    assert.equal(pageVectorScanDone("page-1"), true);
    assert.equal(pageVectorScanDone("page-2"), false);
    clearPageVectorScanCache();
    assert.equal(pageVectorScanDone("page-1"), false);
  });
});
