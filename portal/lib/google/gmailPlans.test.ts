import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeGmailBase64Url } from "./gmailPlans.ts";

describe("decodeGmailBase64Url", () => {
  it("decodes standard base64url payloads", () => {
    // "hello" in base64url
    const bytes = decodeGmailBase64Url("aGVsbG8");
    assert.equal(Buffer.from(bytes).toString("utf8"), "hello");
  });

  it("handles padding-less strings", () => {
    const bytes = decodeGmailBase64Url("YQ"); // "a"
    assert.equal(Buffer.from(bytes).toString("utf8"), "a");
  });
});
