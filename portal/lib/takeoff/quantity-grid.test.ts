import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupQuantitiesByDivision, type QuantityGridRow } from "./quantity-grid.ts";

function row(partial: Partial<QuantityGridRow> & Pick<QuantityGridRow, "id">): QuantityGridRow {
  return {
    label: partial.id,
    csiCode: null,
    division: null,
    quantity: null,
    unit: null,
    pageNumber: null,
    pageId: null,
    documentId: null,
    ...partial,
  };
}

describe("quantity grid divisions", () => {
  it("groups by the first two CSI digits and sums only rows that have a quantity and a unit", () => {
    const groups = groupQuantitiesByDivision([
      row({ id: "slab", division: "03 30 00", csiCode: "03 30 00", quantity: 10, unit: "CY" }),
      row({ id: "footing", csiCode: "03-31-00", quantity: 4, unit: "CY" }),
      row({ id: "unmeasured", csiCode: "03-31-00", quantity: null, unit: "CY" }),
      row({ id: "no-unit", csiCode: "033100", quantity: 2, unit: null }),
      row({ id: "panel", csiCode: "26 24 16", quantity: 3, unit: "EA" }),
      row({ id: "extra-panel", csiCode: "262416", quantity: 1, unit: "EA" }),
      row({ id: "loose", quantity: 8, unit: "LF" }),
    ], (code) => `Division ${code}`);

    const byDivision = new Map(groups.map((group) => [group.division, group]));
    const concrete = byDivision.get("03");
    const electrical = byDivision.get("26");
    const uncoded = byDivision.get("—");

    assert.ok(concrete);
    assert.equal(concrete.name, "Division 03");
    assert.equal(concrete.rows.length, 4);
    assert.deepEqual(concrete.subtotals, [{ unit: "CY", quantity: 14 }]);

    assert.ok(electrical);
    assert.deepEqual(electrical.subtotals, [{ unit: "EA", quantity: 4 }]);

    assert.ok(uncoded);
    assert.equal(uncoded.name, "Uncoded");
    assert.deepEqual(uncoded.subtotals, [{ unit: "LF", quantity: 8 }]);

    const divisions = groups.map((group) => group.division);
    assert.deepEqual(divisions, [...divisions].sort((a, b) => a.localeCompare(b)));
  });

  it("keeps different units in the same division as separate subtotals", () => {
    const [group] = groupQuantitiesByDivision([
      row({ id: "pipe", division: "22", quantity: 100, unit: "LF" }),
      row({ id: "fixture", division: "22", quantity: 6, unit: "EA" }),
    ]);
    assert.deepEqual(group.subtotals, [
      { unit: "LF", quantity: 100 },
      { unit: "EA", quantity: 6 },
    ]);
  });
});
