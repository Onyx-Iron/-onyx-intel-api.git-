import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSheetPin } from "./sheet-pin";

describe("buildSheetPin", () => {
  it("puts the page number on a punch location and an RFI description", () => {
    const punch = buildSheetPin({
      note: "Missing sealant at jamb",
      kind: "punch",
      pageNumber: 4,
      point: { x: 120, y: 80 },
      sheetName: "A-201",
      projectId: "project-1",
    });
    assert.ok(punch);
    assert.equal(punch.punch?.location, "A-201, Page 4");
    assert.equal(punch.geometry.page_number, 4);
    assert.equal(punch.href.includes("tab=punchlist"), true);

    const rfi = buildSheetPin({
      note: "Confirm water tie-in elevation",
      kind: "rfi",
      pageNumber: 7,
      point: { x: 10, y: 12 },
      projectId: "project-1",
    });
    assert.ok(rfi);
    assert.equal(rfi.rfi?.subject, "Confirm water tie-in elevation");
    assert.equal(rfi.rfi?.description.includes("Page 7"), true);
    assert.equal(rfi.href.includes("tab=controls"), true);
  });
});
