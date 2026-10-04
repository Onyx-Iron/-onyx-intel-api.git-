import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSha256Hex, reuseUpload } from "./upload-identity.ts";

describe("upload reuse", () => {
  it("starts a new document when the project has no matching file", () => {
    assert.equal(reuseUpload(null), "new");
    assert.equal(reuseUpload(undefined), "new");
    assert.equal(reuseUpload(""), "new");
  });

  it("leaves a finished or in-flight copy in place", () => {
    for (const status of ["complete", "ready", "done", "pending", "processing", "queued", "split"]) {
      assert.equal(reuseUpload(status), "skip_upload", status);
    }
  });

  it("replaces bytes only after the previous attempt failed", () => {
    assert.equal(reuseUpload("error"), "replace_bytes");
    assert.equal(reuseUpload("failed"), "replace_bytes");
  });
});

describe("content checksum", () => {
  it("accepts a 64-character hex digest and rejects anything else", () => {
    const digest = "ab".repeat(32);
    assert.equal(isSha256Hex(digest), true);
    assert.equal(isSha256Hex(digest.toUpperCase()), true);
    assert.equal(isSha256Hex(digest.slice(0, 63)), false);
    assert.equal(isSha256Hex(`${digest}a`), false);
    assert.equal(isSha256Hex("g".repeat(64)), false);
    assert.equal(isSha256Hex(null), false);
    assert.equal(isSha256Hex(""), false);
  });
});
