import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getStorageProvider,
  isStorageProviderId,
  listStorageProviders,
} from "./providers.ts";

describe("storage provider registry", () => {
  it("lists google_drive, dropbox, sharefile, local_upload, and gmail", () => {
    const ids = listStorageProviders().map((p) => p.id).sort();
    assert.deepEqual(ids, ["dropbox", "gmail", "google_drive", "local_upload", "sharefile"]);
  });

  it("marks OAuth providers correctly", () => {
    assert.equal(getStorageProvider("google_drive").supportsOAuth, true);
    assert.equal(getStorageProvider("dropbox").supportsOAuth, true);
    assert.equal(getStorageProvider("sharefile").supportsOAuth, true);
    assert.equal(getStorageProvider("local_upload").supportsOAuth, false);
    assert.equal(getStorageProvider("gmail").supportsOAuth, false);
  });

  it("type-guards provider ids", () => {
    assert.equal(isStorageProviderId("dropbox"), true);
    assert.equal(isStorageProviderId("icloud"), false);
  });
});
