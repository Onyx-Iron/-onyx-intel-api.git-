import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSha256Hex, reuseUpload } from "./upload-identity.ts";

describe("reuseUpload", () => {
  it("uploads when this project has no matching file", () => {
    assert.equal(reuseUpload(null), "new");
    assert.equal(reuseUpload(undefined), "new");
    assert.equal(reuseUpload(""), "new");
  });

  it("skips a file that is already stored or still processing", () => {
    for (const status of ["complete", "ready", "done", "pending", "processing", "queued", "split"]) {
      assert.equal(reuseUpload(status), "skip_upload", status);
    }
  });

  it("replaces bytes after a failed attempt", () => {
    assert.equal(reuseUpload("failed"), "replace_bytes");
    assert.equal(reuseUpload("error"), "replace_bytes");
  });
});

describe("isSha256Hex", () => {
  it("accepts a 64-character hex digest in either case", () => {
    assert.equal(isSha256Hex("a".repeat(64)), true);
    assert.equal(isSha256Hex("AB".repeat(32)), true);
  });

  it("rejects missing, short, and non-hex checksums", () => {
    assert.equal(isSha256Hex(null), false);
    assert.equal(isSha256Hex(undefined), false);
    assert.equal(isSha256Hex("ab"), false);
    assert.equal(isSha256Hex(`${"a".repeat(64)}\n`), false);
    assert.equal(isSha256Hex("g".repeat(64)), false);
    assert.equal(isSha256Hex("a".repeat(63)), false);
  });
});
