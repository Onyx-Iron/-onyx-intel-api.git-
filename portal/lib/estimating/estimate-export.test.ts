import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyXlsxFormulas, buildEstimateFormulaSheet, formulaMatchesServer, sellPrice } from "./estimate-export.ts";

describe("estimate formula export", () => {
  it("writes live line and group formulas instead of pasted totals", () => {
    const layout = buildEstimateFormulaSheet([
      { description: "Slab", csi_code: "03-30-00", item_type: "material", quantity: 10, uom: "SF", unit_cost: 12.5, total_price: 125, pricing_status: "priced" },
      { description: "Fee", csi_code: "01-31-13", item_type: "fee", quantity: 1, uom: "LS", unit_cost: null, total_price: null, pricing_status: "unpriced" },
    ], "division");
    const sheet: Record<string, { f?: string }> = {};
    applyXlsxFormulas(sheet, layout, (row, column) => `${String.fromCharCode(65 + column)}${row + 1}`);
    const formulas = Object.values(sheet).map((cell) => cell.f).filter(Boolean);
    assert.ok(formulas.some((formula) => formula === "E2*G2"));
    assert.ok(formulas.some((formula) => formula?.startsWith("SUM(H")));
    assert.equal(sellPrice([
      { description: "Slab", total_price: 125, pricing_status: "priced" },
      { description: "Open", total_price: 40, pricing_status: "unpriced" },
      { description: "Gone", total_price: 90, notes: "Source removed", pricing_status: "unpriced" },
    ]), 125);
  });

  it("matches the server line total for an approved quantity", () => {
    const check = formulaMatchesServer(10, 12.5);
    assert.equal(check.formula, check.server);
    assert.equal(check.server, 125);
  });
});
