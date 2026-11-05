import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupQuantitiesByDivision, type QuantityGridRow } from "./quantity-grid.ts";

function row(partial: Partial<QuantityGridRow> & Pick<QuantityGridRow, "id" | "label">): QuantityGridRow {
  return {
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

describe("groupQuantitiesByDivision", () => {
  it("groups division digits, keeps units apart, and skips blank quantities", () => {
    const groups = groupQuantitiesByDivision(
      [
        row({ id: "1", label: "Slab", csiCode: "03 30 00", division: "03", quantity: 10, unit: "CY" }),
        row({ id: "2", label: "Footing", csiCode: "033000", quantity: 2.5, unit: "CY" }),
        row({ id: "3", label: "Wall", csiCode: "03 30 00", division: "03", quantity: 40, unit: "SF" }),
        row({ id: "4", label: "Note" }),
        row({ id: "5", label: "Steel", csiCode: "05 12 00", division: "05", quantity: 4, unit: null }),
      ],
      (code) => (code === "03" ? "Concrete" : code),
    );

    const concrete = groups.find((group) => group.division === "03");
    const steel = groups.find((group) => group.division === "05");
    const uncoded = groups.find((group) => group.division === "—");

    assert.ok(concrete);
    assert.equal(concrete.name, "Concrete");
    assert.deepEqual(
      concrete.rows.map((item) => item.label),
      ["Slab", "Footing", "Wall"],
    );
    assert.deepEqual(concrete.subtotals, [
      { unit: "CY", quantity: 12.5 },
      { unit: "SF", quantity: 40 },
    ]);

    assert.ok(steel);
    assert.equal(steel.rows.length, 1);
    assert.deepEqual(steel.subtotals, []);

    assert.ok(uncoded);
    assert.equal(uncoded.name, "Uncoded");
    assert.deepEqual(uncoded.subtotals, []);
    assert.deepEqual(
      groups.map((group) => group.division),
      [...groups.map((group) => group.division)].sort((a, b) => a.localeCompare(b)),
    );
  });
});
