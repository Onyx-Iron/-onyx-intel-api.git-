import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateScopeWorkUnits, normalizeScopeSelection, validateScopeSelection } from "./scope";

describe("takeoff scope preflight", () => {
  it("requires a selection for selective modes", () => {
    const selection = { mode: "selected_trades" as const, divisionCodes: [], tradeKeys: [], bidPackageIds: [], documentIds: [], sheetIds: [], alternateKeys: [] };
    assert.equal(validateScopeSelection(selection).length, 1);
  });

  it("normalizes and deduplicates known divisions", () => {
    const selection = normalizeScopeSelection({ mode: "selected_trades", divisionCodes: ["3", "03", "99"], tradeKeys: [], bidPackageIds: [], documentIds: [], sheetIds: [], alternateKeys: [] });
    assert.deepEqual(selection.divisionCodes, ["03"]);
    assert.equal(estimateScopeWorkUnits(selection), 1);
  });
});
