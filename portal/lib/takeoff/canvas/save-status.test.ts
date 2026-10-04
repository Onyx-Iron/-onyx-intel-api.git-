import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveStatusLine } from "./save-status.ts";

const clear = {
  unsaved: 0,
  saving: false,
  conflict: false,
  scaleUnconfirmed: false,
  outboxFailed: 0,
  outboxCompleted: 0,
};

describe("saveStatusLine", () => {
  it("prefers the in-progress write, then conflict, then unsaved work", () => {
    assert.equal(saveStatusLine({ ...clear, saving: true, unsaved: 2 }), "Saving");
    assert.equal(saveStatusLine({ ...clear, conflict: true }), "Conflict");
    assert.equal(saveStatusLine({ ...clear, unsaved: 1, scaleUnconfirmed: true }), "Unsaved");
  });

  it("reports scale, then estimate sync, then saved", () => {
    assert.equal(saveStatusLine({ ...clear, scaleUnconfirmed: true }), "Scale not confirmed");
    assert.equal(saveStatusLine({ ...clear, outboxFailed: 1 }), "Estimate sync pending");
    assert.equal(saveStatusLine({ ...clear, outboxCompleted: 2 }), "Estimate sync complete");
    assert.equal(saveStatusLine(clear), "Saved");
  });
});
