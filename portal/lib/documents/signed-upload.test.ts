import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertUploadSize,
  buildOriginalStoragePath,
  extensionOf,
  MAX_UPLOAD_BYTES,
  parseSignedUploadPayload,
  sanitizeFileName,
  TUS_THRESHOLD_BYTES,
  VERCEL_SAFE_UPLOAD_BYTES,
} from "./signed-upload.ts";

describe("signed-upload helpers", () => {
  it("sanitizes and preserves extensions", () => {
    assert.equal(sanitizeFileName("../../Civil Set A-101.pdf"), "Civil_Set_A-101.pdf");
    assert.equal(extensionOf("site.DWG"), ".dwg");
    assert.equal(extensionOf("noext"), ".bin");
  });

  it("builds originals/ paths expected by page-split-worker for PDFs", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    assert.equal(buildOriginalStoragePath(id, "Plan.pdf"), `originals/${id}.pdf`);
    assert.equal(buildOriginalStoragePath(id, "Model.dwg"), `originals/${id}.dwg`);
  });

  it("parses signed upload payloads across client shapes", () => {
    assert.equal(parseSignedUploadPayload({ signedUrl: "https://a" }).url, "https://a");
    assert.equal(parseSignedUploadPayload({ signedURL: "https://b", token: "t" }).token, "t");
    assert.equal(parseSignedUploadPayload({ url: "https://c" }).url, "https://c");
  });

  it("enforces the 1GB ceiling and exposes size thresholds", () => {
    assert.equal(assertUploadSize(100), null);
    assert.match(assertUploadSize(MAX_UPLOAD_BYTES + 1) ?? "", /1GB/);
    assert.ok(VERCEL_SAFE_UPLOAD_BYTES < TUS_THRESHOLD_BYTES);
    assert.ok(TUS_THRESHOLD_BYTES < MAX_UPLOAD_BYTES);
  });
});
