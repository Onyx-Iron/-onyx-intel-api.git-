import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sheetProgressCopy } from "./sheet-progress.ts";

describe("sheetProgressCopy", () => {
  it("reports a partial split against the document page count", () => {
    assert.equal(sheetProgressCopy(12, 40), "12 of 40 sheets ready");
  });

  it("stays quiet when nothing has been counted yet", () => {
    assert.equal(sheetProgressCopy(0, 0), null);
  });
});
