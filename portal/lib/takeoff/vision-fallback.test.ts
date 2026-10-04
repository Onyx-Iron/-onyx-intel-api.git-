import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { itemsFromPageGeometry, itemsFromScheduleRows } from "./local-sheet-items.ts";
import { pagesQueuedForVision } from "./vision-fallback.ts";

describe("local takeoff candidates", () => {
  it("does not queue a dense drawing for vision", () => {
    assert.deepEqual(pagesQueuedForVision(), []);
  });

  it("groups saved vectors by layer and keeps length quantities at zero", () => {
    const vectors = Array.from({ length: 40 }, (_, index) => ({
      layer: "C-SSWR",
      type: "polyline" as const,
      points: [[index, 0], [index + 1, 0]] as Array<[number, number]>,
    }));
    const built = itemsFromPageGeometry(vectors, "SITE PLAN sanitary sewer scale 1/4\" = 1'-0\"");
    assert.equal(built.items.length, 1);
    assert.equal(built.items[0]?.source, "text");
    assert.equal(built.items[0]?.quantity, 0);
    assert.equal(built.items[0]?.cost_code, "33-31-00");
  });

  it("keeps a page empty when it has no text and no vectors", () => {
    assert.deepEqual(itemsFromPageGeometry([], "   "), { items: [], page_summary: "" });
  });

  it("keeps schedule rows that the table parser already saved", () => {
    const items = itemsFromScheduleRows([{ label: "Type A door", quantity: 12, unit: "EA", csi_code: "08-14-00" }]);
    assert.equal(items[0]?.source, "schedule");
    assert.equal(items[0]?.quantity, 12);
  });
});
