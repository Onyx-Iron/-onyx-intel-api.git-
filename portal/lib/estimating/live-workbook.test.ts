import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLiveWorkbook } from "./live-workbook.ts";

describe("live estimate workbook", () => {
  it("keeps the bid as formulas that follow the schedule direct column", () => {
    const book = buildLiveWorkbook("Pad", [{
      cost_code: "03-30-00",
      description: "Slab",
      quantity: 10,
      unit: "CY",
      labor_unit: 2,
      material_unit: 3,
      equipment_unit: 0,
      subcontractor_unit: 0,
      trucking_unit: 0,
      disposal_unit: 0,
    }], { contingency_pct: 10, overhead_pct: 5, profit_pct: 8 });

    const direct = book.schedule[1][17] as { f: string };
    assert.equal(direct.f, "SUM(L2:Q2)");
    assert.equal((book.schedule[1][11] as { f: string }).f, "D2*F2");
    assert.equal((book.proposal[2][1] as { f: string }).f, "SUM('Schedule of Values'!R2:R2)");
    assert.equal((book.proposal[7][1] as { f: string }).f, "B5+B6+B7");
    assert.equal(book.settings[0][1], 0.1);
  });
});