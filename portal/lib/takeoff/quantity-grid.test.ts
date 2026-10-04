import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupQuantitiesByDivision, type QuantityGridRow } from "./quantity-grid.ts";

function row(overrides: Partial<QuantityGridRow> = {}): QuantityGridRow {
  return {
    id: "row",
    label: "Item",
    csiCode: null,
    division: null,
    quantity: null,
    unit: null,
    pageNumber: 1,
    pageId: "page",
    documentId: "doc",
    ...overrides,
  };
}

describe("groupQuantitiesByDivision", () => {
  it("groups spaced CSI codes into a two-digit division and sums like units", () => {
    const groups = groupQuantitiesByDivision([
      row({ id: "slab", division: "03", csiCode: "03 30 00", quantity: 120, unit: "SF" }),
      row({ id: "footing", division: null, csiCode: "03-30-00", quantity: 40, unit: "SF" }),
      row({ id: "wall", division: "03 30 00", quantity: 18, unit: "LF" }),
    ], (code) => `Division ${code}`);

    assert.deepEqual(groups.map((group) => group.division), ["03"]);
    assert.equal(groups[0]?.name, "Division 03");
    assert.deepEqual(groups[0]?.rows.map((item) => item.id), ["slab", "footing", "wall"]);
    assert.deepEqual(groups[0]?.subtotals, [
      { unit: "SF", quantity: 160 },
      { unit: "LF", quantity: 18 },
    ]);
  });

  it("keeps an unscaled row on the grid without adding it to the subtotal", () => {
    const groups = groupQuantitiesByDivision([
      row({ id: "scaled", division: "26", quantity: 4, unit: "EA" }),
      row({ id: "unscaled", division: "26", quantity: null, unit: "EA" }),
      row({ id: "no-unit", division: "26", quantity: 9, unit: null }),
      row({ id: "zero", division: "26", quantity: 0, unit: "EA" }),
    ]);

    assert.deepEqual(groups[0]?.rows.map((item) => item.id), ["scaled", "unscaled", "no-unit", "zero"]);
    assert.deepEqual(groups[0]?.subtotals, [{ unit: "EA", quantity: 4 }]);
  });

  it("puts blank codes in Uncoded and sorts divisions with the same comparison as the grid", () => {
    const seen: string[] = [];
    const groups = groupQuantitiesByDivision([
      row({ id: "steel", division: "05", quantity: 2, unit: "TN" }),
      row({ id: "blank", division: "  ", csiCode: null, quantity: 1, unit: "EA" }),
      row({ id: "elec", csiCode: "26 24 16", quantity: 3, unit: "EA" }),
    ], (code) => {
      seen.push(code);
      return `Division ${code}`;
    });

    const expectedOrder = ["—", "05", "26"].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(groups.map((group) => group.division), expectedOrder);
    assert.equal(groups.find((group) => group.division === "—")?.name, "Uncoded");
    assert.deepEqual(seen.sort(), ["05", "26"]);
    assert.ok(groups.findIndex((group) => group.division === "05") < groups.findIndex((group) => group.division === "26"));
  });
});
