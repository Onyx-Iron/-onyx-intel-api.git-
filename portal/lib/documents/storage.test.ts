import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PLANS_BUCKET,
  PROJECT_DOCUMENTS_BUCKET,
  resolveDocumentStorageBucket,
} from "./storage.ts";

describe("resolveDocumentStorageBucket", () => {
  it("uses project-documents for supabase local uploads", () => {
    assert.equal(
      resolveDocumentStorageBucket({ storage: "supabase", storage_path: "tenant/proj/file.pdf" }),
      PROJECT_DOCUMENTS_BUCKET,
    );
  });

  it("uses plans-bucket for drive-backed uploads by default", () => {
    assert.equal(
      resolveDocumentStorageBucket({ storage: "plans-bucket", storage_path: "originals/x.pdf" }),
      PLANS_BUCKET,
    );
  });

  it("honours explicit non-drive storage bucket names", () => {
    assert.equal(
      resolveDocumentStorageBucket({ storage: "custom-bucket", storage_path: "a/b.pdf" }),
      "custom-bucket",
    );
  });
});
