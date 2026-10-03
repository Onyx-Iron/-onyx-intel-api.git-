import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildQuantitySummary } from "./quantity-summary.ts";

describe("buildQuantitySummary", () => {
  it("aggregates by cost code and unit", () => {
    const rows = buildQuantitySummary([
      { tool: "length", cost_code: "03-30-00", quantity: 10, unit: "LF" },
      { tool: "length", cost_code: "03-30-00", quantity: 5, unit: "LF" },
      { tool: "count", cost_code: "26-05-00", quantity: 3, unit: "EA" },
    ]);
    assert.equal(rows.length, 2);
    const concrete = rows.find((r) => r.costCode === "03-30-00");
    assert.equal(concrete?.quantity, 15);
    assert.equal(concrete?.count, 2);
  });
});
