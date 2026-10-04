import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunkReloadDecision, isChunkLoadError, PDFJS_CHUNK_RELOAD_KEY } from "./chunk-reload.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

describe("pdf.js chunk reload", () => {
  it("reloads once when the sheet chunk fails to load", () => {
    const storage = memoryStorage();
    const error = new Error("Failed to load chunk /_next/static/chunks/25dbgmmhqj62p.js from module 400287");
    assert.equal(isChunkLoadError(error), true);
    assert.equal(chunkReloadDecision(error, storage), "reload");
    assert.equal(storage.getItem(PDFJS_CHUNK_RELOAD_KEY), "1");
    assert.equal(chunkReloadDecision(error, storage), "show");
  });

  it("shows a normal load error without reloading", () => {
    const storage = memoryStorage();
    assert.equal(chunkReloadDecision(new Error("Invalid PDF structure"), storage), "show");
    assert.equal(storage.getItem(PDFJS_CHUNK_RELOAD_KEY), null);
  });
});
