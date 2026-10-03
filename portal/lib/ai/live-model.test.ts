import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOCUMENT_EMBED_MODEL, DOCUMENT_EXTRACT_MODEL, liveModel } from "./live-model.ts";

describe("liveModel", () => {
  it("replaces shut-down Gemini ids with the current model", () => {
    assert.equal(liveModel("gemini-2.0-flash-001", DOCUMENT_EXTRACT_MODEL), DOCUMENT_EXTRACT_MODEL);
    assert.equal(liveModel("text-embedding-004", DOCUMENT_EMBED_MODEL), DOCUMENT_EMBED_MODEL);
    assert.equal(liveModel("  gemini-2.0-flash  ", DOCUMENT_EXTRACT_MODEL), DOCUMENT_EXTRACT_MODEL);
  });

  it("keeps a configured model that is still available", () => {
    assert.equal(liveModel("gemini-2.5-pro", DOCUMENT_EXTRACT_MODEL), "gemini-2.5-pro");
  });

  it("uses the fallback when nothing is configured", () => {
    assert.equal(liveModel(undefined, DOCUMENT_EXTRACT_MODEL), DOCUMENT_EXTRACT_MODEL);
    assert.equal(liveModel("  ", DOCUMENT_EMBED_MODEL), DOCUMENT_EMBED_MODEL);
  });
});
