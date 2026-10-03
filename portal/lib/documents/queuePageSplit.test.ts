import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASYNC_SPLIT_BYTES,
  isPdfFileName,
  shouldAsyncSplitPdf,
} from "./queuePageSplit.ts";

describe("queuePageSplit helpers", () => {
  it("detects PDF file names case-insensitively", () => {
    assert.equal(isPdfFileName("plan.pdf"), true);
    assert.equal(isPdfFileName("PLAN.PDF"), true);
    assert.equal(isPdfFileName("notes.txt"), false);
  });

  it("async-splits PDFs at or above the size threshold", () => {
    assert.equal(shouldAsyncSplitPdf("a.pdf", ASYNC_SPLIT_BYTES), true);
    assert.equal(shouldAsyncSplitPdf("a.pdf", ASYNC_SPLIT_BYTES + 1), true);
    assert.equal(shouldAsyncSplitPdf("a.pdf", ASYNC_SPLIT_BYTES - 1), false);
  });

  it("treats missing/invalid PDF size as large (safe default)", () => {
    assert.equal(shouldAsyncSplitPdf("a.pdf", null), true);
    assert.equal(shouldAsyncSplitPdf("a.pdf", undefined), true);
    assert.equal(shouldAsyncSplitPdf("a.pdf", Number.NaN), true);
  });

  it("never async-splits non-PDFs regardless of size", () => {
    assert.equal(shouldAsyncSplitPdf("photo.png", 50 * 1024 * 1024), false);
    assert.equal(shouldAsyncSplitPdf("notes.txt", null), false);
  });
});
