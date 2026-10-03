import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors attach-documents route merge into meta.document_ids. */
function mergeDocumentIds(prev: string[] | undefined, incoming: string[]): string[] {
  const ids = incoming.filter((x) => typeof x === "string" && x.length > 0);
  return Array.from(new Set([...(prev ?? []), ...ids]));
}

describe("attach-documents merge", () => {
  it("merges and dedupes document ids", () => {
    assert.deepEqual(
      mergeDocumentIds(["a", "b"], ["b", "c"]),
      ["a", "b", "c"],
    );
  });

  it("starts from empty meta", () => {
    assert.deepEqual(mergeDocumentIds(undefined, ["x"]), ["x"]);
  });

  it("drops empty strings", () => {
    assert.deepEqual(mergeDocumentIds([], ["", "ok"]), ["ok"]);
  });
});
