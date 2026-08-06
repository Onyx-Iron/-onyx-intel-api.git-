import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLocalDocumentInsert,
  detectDocumentUploadStorageType,
  resolveDocumentStorageBucket,
} from "./upload.ts";

describe("document upload helpers", () => {
  it("routes multipart uploads to supabase and JSON uploads to drive by default", () => {
    assert.equal(detectDocumentUploadStorageType({ contentType: "multipart/form-data; boundary=abc" }), "supabase");
    assert.equal(detectDocumentUploadStorageType({ contentType: "application/json" }), "drive");
    assert.equal(detectDocumentUploadStorageType({ contentType: "application/json", bodyStorageType: "supabase" }), "supabase");
  });

  it("builds the local upload document insert payload", () => {
    const row = buildLocalDocumentInsert({
      documentId: "doc-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      fileName: "Site Plan Rev 2.pdf",
      storagePath: "tenant-1/project-1/site-plan.pdf",
      fileSize: 1234,
      contentType: "application/pdf",
    });

    assert.equal(row.id, "doc-1");
    assert.equal(row.project_id, "project-1");
    assert.equal(row.status, "pending");
    assert.equal((row.meta as Record<string, unknown>).storage_path, "tenant-1/project-1/site-plan.pdf");
    assert.equal((row.meta as Record<string, unknown>).storage_bucket, "project-documents");
  });

  it("resolves current and legacy document storage buckets", () => {
    assert.equal(resolveDocumentStorageBucket({ storage_bucket: "custom-bucket" }), "custom-bucket");
    assert.equal(resolveDocumentStorageBucket({ source: "local_upload" }), "project-documents");
    assert.equal(resolveDocumentStorageBucket({ storage: "supabase" }), "project-documents");
    assert.equal(resolveDocumentStorageBucket({ source: "google_drive" }), "plans-bucket");
  });
});
