import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSha256Hex, reuseUpload } from "./upload-identity.ts";

describe("reuseUpload", () => {
  it("skips a second upload while the same file is in flight or already complete", () => {
    for (const status of ["pending", "processing", "queued", "split", "complete", "ready", "done"]) {
      assert.equal(reuseUpload(status), "skip_upload", status);
    }
  });

  it("replaces bytes when the previous copy failed or finished with page errors", () => {
    for (const status of ["error", "failed", "complete_with_errors"]) {
      assert.equal(reuseUpload(status), "replace_bytes", status);
    }
  });

  it("starts a new document when there is no prior status", () => {
    assert.equal(reuseUpload(null), "new");
    assert.equal(reuseUpload(undefined), "new");
    assert.equal(reuseUpload(""), "new");
  });
});

describe("isSha256Hex", () => {
  it("accepts a 64-character hex digest in either case", () => {
    const lower = "ab".repeat(32);
    assert.equal(isSha256Hex(lower), true);
    assert.equal(isSha256Hex(lower.toUpperCase()), true);
  });

  it("rejects missing, short, and non-hex values", () => {
    assert.equal(isSha256Hex(null), false);
    assert.equal(isSha256Hex(undefined), false);
    assert.equal(isSha256Hex(""), false);
    assert.equal(isSha256Hex("ab".repeat(31)), false);
    assert.equal(isSha256Hex(`${"ab".repeat(32)}ff`), false);
    assert.equal(isSha256Hex(`${"zz".repeat(32)}`), false);
    assert.equal(isSha256Hex(` ${"ab".repeat(32)}`), false);
  });
});
