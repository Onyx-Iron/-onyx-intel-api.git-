import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reuseUpload } from "./upload-identity.ts";

describe("reuseUpload", () => {
  it("keeps a partial plan when the same file is dropped again", () => {
    assert.equal(reuseUpload("complete_with_errors"), "skip_upload");
    assert.equal(reuseUpload("complete"), "skip_upload");
    assert.equal(reuseUpload("ready"), "skip_upload");
    assert.equal(reuseUpload("done"), "skip_upload");
  });

  it("does not treat an in-flight upload as a fresh document", () => {
    assert.equal(reuseUpload("pending"), "skip_upload");
    assert.equal(reuseUpload("processing"), "skip_upload");
    assert.equal(reuseUpload("queued"), "skip_upload");
    assert.equal(reuseUpload("split"), "skip_upload");
  });

  it("replaces bytes only after a failed attempt", () => {
    assert.equal(reuseUpload("error"), "replace_bytes");
    assert.equal(reuseUpload("failed"), "replace_bytes");
    assert.equal(reuseUpload(null), "new");
    assert.equal(reuseUpload(undefined), "new");
  });
});
