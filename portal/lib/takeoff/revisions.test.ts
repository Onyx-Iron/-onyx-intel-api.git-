import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCandidateCurrent, normalizeSheetIdentity, proposeRevisionLineage } from "./revisions";

describe("takeoff source revision authority", () => {
  const oldA101 = { sheetNumber: "A-101", discipline: "Architectural", revision: "1", issueDate: "2026-01-01", checksum: "old" };
  const newA101 = { ...oldA101, revision: "2", issueDate: "2026-02-01", checksum: "new" };

  it("normalizes formatting without merging disciplines", () => {
    assert.equal(normalizeSheetIdentity(oldA101), "ARCHITECTURAL:A101");
    assert.notEqual(
      normalizeSheetIdentity(oldA101),
      normalizeSheetIdentity({ ...oldA101, discipline: "Structural" }),
    );
  });

  it("proposes supersession only for the same sheet identity", () => {
    assert.equal(proposeRevisionLineage(oldA101, newA101).kind, "supersedes_proposed");
    assert.equal(proposeRevisionLineage(oldA101, { ...newA101, discipline: "Structural" }).kind, "conflict");
    assert.equal(proposeRevisionLineage(oldA101, { ...oldA101 }).kind, "same_source");
  });

  it("marks a candidate stale when its authority or checksum changed", () => {
    assert.equal(isCandidateCurrent({ manifestVersion: 1, sourceChecksum: "old" }, { manifestVersion: 2, sourceChecksum: "new" }), false);
    assert.equal(isCandidateCurrent({ manifestVersion: 2, sourceChecksum: "new" }, { manifestVersion: 2, sourceChecksum: "new" }), true);
  });
});
