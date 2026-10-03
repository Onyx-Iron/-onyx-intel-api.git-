import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PersistedGeometryRevision } from "./persisted-geometry-revision.ts";

describe("PersistedGeometryRevision", () => {
  const revision = () => new PersistedGeometryRevision({
    id: "mt-1",
    rowVersion: 4,
    unit: "LF",
    costCode: "33-11-00",
    label: "storm",
    assemblyKey: null,
    before: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], quantity: 100 },
    after: { points: [{ x: 0, y: 0 }, { x: 25, y: 0 }], quantity: 250 },
  });

  it("undo sends the post-commit row_version and the original geometry", () => {
    const undo = revision().undoBody();
    assert.equal(undo.row_version, 4);
    assert.equal(undo.quantity, 100);
    assert.deepEqual(undo.geometry.points, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    assert.equal(undo.geometry.coordinate_space, "page_space");
    assert.equal(undo.cost_code, "33-11-00");
  });

  it("does not advance the version when the undo response is rejected", () => {
    const edit = revision();
    const first = edit.undoBody();
    assert.equal(first.row_version, 4);
    // Failed PATCH: caller must not accept(). Redo still targets version 4.
    assert.equal(edit.redoBody().row_version, 4);
    assert.equal(edit.redoBody().quantity, 250);
  });

  it("redo uses the version returned by a successful undo", () => {
    const edit = revision();
    edit.accept(5);
    const redo = edit.redoBody();
    assert.equal(redo.row_version, 5);
    assert.equal(redo.quantity, 250);
    assert.deepEqual(redo.geometry.points, [{ x: 0, y: 0 }, { x: 25, y: 0 }]);
    edit.accept(6);
    assert.equal(edit.undoBody().row_version, 6);
    assert.equal(edit.undoBody().quantity, 100);
  });
});
