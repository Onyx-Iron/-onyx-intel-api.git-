import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCsiCode, parsePriceCsv, unitsMatch } from "./price-import.ts";

describe("parsePriceCsv", () => {
  it("keeps a split that adds up to the unit cost and normalizes the CSI code", () => {
    const parsed = parsePriceCsv([
      "cost code,description,unit,unit cost,labor,material,equipment,region,date",
      "033000,Cast in place,CY,185,80,90,15,MO,2024-03-01",
    ].join("\n"));
    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.rows[0].csi_code, "03-30-00");
    assert.equal(parsed.rows[0].unit_cost, 185);
    assert.equal(parsed.rows[0].labor_cost, 80);
    assert.equal(parsed.rows[0].region_code, "MO");
    assert.equal(parsed.rows[0].effective_from, "2024-03-01");
  });

  it("stores a flat unit cost when the split does not add up", () => {
    const parsed = parsePriceCsv("csi_code,unit_cost,labor,material,equipment\n22-11-00,10,8,2,2\n");
    assert.equal(parsed.rows[0].unit_cost, 10);
    assert.equal(parsed.rows[0].labor_cost, null);
    assert.equal(parsed.rows[0].material_cost, null);
    assert.equal(parsed.rows[0].equipment_cost, null);
  });

  it("rejects a row with no code or no rate", () => {
    const parsed = parsePriceCsv("csi_code,description,unit,unit_cost\n,Pipe,LF,12\n22-11-00,Pipe,LF,\n");
    assert.equal(parsed.rows.length, 0);
    assert.equal(parsed.rejected[0].reason, "cost code is required");
    assert.equal(parsed.rejected[1].reason, "unit cost must be greater than zero");
  });

  it("rejects an effective date that is not a date", () => {
    const parsed = parsePriceCsv("csi_code,unit_cost,date\n22-11-00,12,March\n");
    assert.equal(parsed.rejected[0].reason, "effective date is not a date");
  });
});

describe("cost code and unit tokens", () => {
  it("normalizes spaced and dotted codes", () => {
    assert.equal(normalizeCsiCode("03 30 00"), "03-30-00");
    assert.equal(normalizeCsiCode("03.30.00"), "03-30-00");
    assert.equal(normalizeCsiCode("3300"), null);
  });

  it("treats feet and LF as the same unit", () => {
    assert.equal(unitsMatch("ft", "LF"), true);
    assert.equal(unitsMatch("CY", "LF"), false);
    assert.equal(unitsMatch("", "LF"), true);
  });
});
