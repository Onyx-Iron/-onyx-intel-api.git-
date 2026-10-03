import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chooseIngestRoute,
  documentStorageBuckets,
  mimeTypeForFile,
  originalStoragePath,
  PAGE_SPLIT_BYTES,
} from "./upload-plan.ts";

describe("document upload plan", () => {
  it("sends every plans-bucket or Drive PDF to the splitter and keeps images inline", () => {
    assert.equal(chooseIngestRoute({
      fileName: "plans.pdf",
      sizeBytes: 12_000,
      storage: "plans-bucket",
      storagePath: "originals/doc.pdf",
    }), "split-storage");
    assert.equal(chooseIngestRoute({
      fileName: "plans.pdf",
      sizeBytes: null,
      driveFileId: "drive-1",
    }), "split-drive");
    assert.equal(chooseIngestRoute({
      fileName: "photo.jpg",
      sizeBytes: PAGE_SPLIT_BYTES * 2,
      storage: "plans-bucket",
      storagePath: "originals/doc.jpg",
    }), "inline");
    assert.equal(chooseIngestRoute({
      fileName: "old.pdf",
      sizeBytes: PAGE_SPLIT_BYTES - 1,
      storage: "project-documents",
      storagePath: "tenant/project/old.pdf",
    }), "inline");
    assert.equal(chooseIngestRoute({
      fileName: "old.pdf",
      sizeBytes: PAGE_SPLIT_BYTES,
      storage: "project-documents",
      storagePath: "tenant/project/old.pdf",
    }), "reupload");
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
