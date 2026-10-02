import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeSavedRows, type MatrixRow } from "./matrix-rows.ts";

function row(patch: Partial<MatrixRow> = {}): MatrixRow {
  return {
    id: "row-1",
    cost_code: "03-30-00",
    description: "Concrete",
    quantity: 10,
    unit: "CY",
    labor_unit: 1,
    material_unit: 2,
    equipment_unit: 0,
    subcontractor_unit: 0,
    trucking_unit: 0,
    disposal_unit: 0,
    notes: "",
    sort_order: 0,
    _dirty: true,
    ...patch,
  };
}

describe("mergeSavedRows", () => {
  it("clears the dirty flag and keeps rows that were not in the save", () => {
    const current = [row(), row({ id: "row-2", description: "Rebar", _dirty: false })];
    const saved = [{
      id: "row-1",
      cost_code: "03-30-00",
      description: "Concrete",
      quantity: 10,
      uom: "CY",
      labor_cost: 10,
      material_cost: 20,
      equipment_cost: 0,
      trucking_cost: 0,
      subcontract_cost: 0,
      disposal_cost: 0,
      notes: null,
      sort_order: 0,
    }];

    const merged = mergeSavedRows(current, saved, [current[0]]);
    assert.equal(merged[0]._dirty, false);
    assert.equal(merged[0].labor_unit, 1);
    assert.equal(merged[1].description, "Rebar");
    assert.equal(merged[1]._dirty, false);
  });

  it("keeps a row the user edited while the save was in flight", () => {
    const snapshot = [row({ description: "Concrete" })];
    const current = [row({ description: "Concrete revised" })];
    const merged = mergeSavedRows(current, [{
      id: "row-1",
      cost_code: "03-30-00",
      description: "Concrete",
      quantity: 10,
      uom: "CY",
      labor_cost: 10,
      material_cost: 20,
      equipment_cost: 0,
      trucking_cost: 0,
      subcontract_cost: 0,
      disposal_cost: 0,
      notes: "",
    }], snapshot);
    assert.equal(merged[0].description, "Concrete revised");
    assert.equal(merged[0]._dirty, true);
  });
});
