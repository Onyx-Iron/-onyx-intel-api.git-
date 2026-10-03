import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  documentStorageBuckets,
  mimeTypeForFile,
  originalStoragePath,
  PAGE_SPLIT_BYTES,
  shouldQueuePageSplit,
} from "./upload-plan.ts";

describe("document upload plan", () => {
  it("queues a large PDF that already has a source and leaves small files on the direct ingest path", () => {
    assert.equal(shouldQueuePageSplit({
      fileName: "plans.pdf",
      sizeBytes: PAGE_SPLIT_BYTES,
      hasSource: true,
    }), true);
    assert.equal(shouldQueuePageSplit({
      fileName: "sheet.pdf",
      sizeBytes: PAGE_SPLIT_BYTES - 1,
      hasSource: true,
    }), false);
    assert.equal(shouldQueuePageSplit({
      fileName: "photo.jpg",
      sizeBytes: PAGE_SPLIT_BYTES * 2,
      hasSource: true,
    }), false);
    assert.equal(shouldQueuePageSplit({
      fileName: "plans.pdf",
      sizeBytes: null,
      hasSource: true,
    }), false);
  });

  it("stores PDFs where the page-split worker already looks", () => {
    assert.equal(originalStoragePath("doc-1", "Level 1.pdf"), "originals/doc-1.pdf");
    assert.equal(originalStoragePath("doc-1", "photo.PNG"), "originals/doc-1.png");
  });

  it("reads a new plans-bucket file first and still finds older project-documents uploads", () => {
    assert.deepEqual(documentStorageBuckets({ storage: "plans-bucket" }), ["plans-bucket", "project-documents"]);
    assert.deepEqual(documentStorageBuckets({ storage: "supabase" }), ["plans-bucket", "project-documents"]);
  });

  it("does not label a drawing as a PDF when the browser omitted a type", () => {
    assert.equal(mimeTypeForFile("A1.pdf", ""), "application/pdf");
    assert.equal(mimeTypeForFile("photo.jpg", "application/octet-stream"), "image/jpeg");
    assert.equal(mimeTypeForFile("sheet.pdf", "application/pdf"), "application/pdf");
  });
});
