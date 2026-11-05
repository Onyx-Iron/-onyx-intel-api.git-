import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSha256Hex, reuseUpload } from "./upload-identity.ts";

describe("reuseUpload", () => {
  it("starts a new document when nothing is stored yet", () => {
    assert.equal(reuseUpload(null), "new");
    assert.equal(reuseUpload(undefined), "new");
    assert.equal(reuseUpload(""), "new");
  });

  it("skips a second upload while the first is in flight or already done", () => {
    for (const status of ["pending", "processing", "queued", "split", "complete", "ready", "done"]) {
      assert.equal(reuseUpload(status), "skip_upload", status);
    }
  });

  it("replaces bytes after a failed or unrecognized status", () => {
    assert.equal(reuseUpload("failed"), "replace_bytes");
    assert.equal(reuseUpload("error"), "replace_bytes");
    assert.equal(reuseUpload("Complete"), "replace_bytes");
  });
});

describe("isSha256Hex", () => {
  it("accepts a 64-character hex digest in either case", () => {
    const lower = "a".repeat(64);
    const mixed = `${"ab".repeat(31)}CD`;
    assert.equal(isSha256Hex(lower), true);
    assert.equal(isSha256Hex(mixed), true);
  });

  it("rejects missing, short, and non-hex values", () => {
    assert.equal(isSha256Hex(null), false);
    assert.equal(isSha256Hex(undefined), false);
    assert.equal(isSha256Hex(""), false);
    assert.equal(isSha256Hex("a".repeat(63)), false);
    assert.equal(isSha256Hex(`${"g".repeat(64)}`), false);
    assert.equal(isSha256Hex(`${"a".repeat(64)} `), false);
  });
});
