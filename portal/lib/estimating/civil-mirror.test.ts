import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { civilMirrorTakeoffRefs } from "./civil-mirror-refs.ts";

describe("civilMirrorTakeoffRefs", () => {
  it("keeps the page id off document_id so the plan foreign key can accept the row", () => {
    const refs = civilMirrorTakeoffRefs("page-1", "plan-doc-1");
    assert.equal(refs.sheet_id, "page-1");
    assert.equal(refs.document_id, "plan-doc-1");
    assert.notEqual(refs.document_id, refs.sheet_id);
  });

  it("leaves both ids empty when the run is not on a sheet", () => {
    assert.deepEqual(civilMirrorTakeoffRefs(null, "plan-doc-1"), {
      document_id: null,
      sheet_id: null,
    });
  });
});
