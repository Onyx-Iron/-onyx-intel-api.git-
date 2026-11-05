import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finiteQuantity, groupQuantitiesByDivision, type QuantityGridRow } from "./quantity-grid.ts";

function row(quantity: number | string | null, unit = "LF"): QuantityGridRow {
  return {
    id: String(quantity),
    label: "Wall",
    csiCode: "03",
    division: "03",
    quantity,
    unit,
    pageNumber: 1,
    pageId: null,
    documentId: null,
  };
}

describe("quantity grid numeric strings", () => {
  it("parses a Postgres numeric string", () => {
    assert.equal(finiteQuantity("12.5000"), 12.5);
    assert.equal(finiteQuantity(4), 4);
    assert.equal(finiteQuantity(0), 0);
    assert.equal(finiteQuantity(null), null);
    assert.equal(finiteQuantity(""), null);
    assert.equal(finiteQuantity("12.5000")?.toFixed(2) ?? "—", "12.50");
    assert.equal(finiteQuantity(0)?.toFixed(2) ?? "—", "0.00");
    assert.equal(finiteQuantity("nope")?.toFixed(2) ?? "—", "—");
  });

  it("sums string quantities instead of concatenating them", () => {
    const [group] = groupQuantitiesByDivision([row("10.5000"), row("2.2500")]);
    assert.equal(group.subtotals.length, 1);
    assert.equal(group.subtotals[0].quantity, 12.75);
    assert.equal(group.subtotals[0].quantity.toFixed(2), "12.75");
  });
});
