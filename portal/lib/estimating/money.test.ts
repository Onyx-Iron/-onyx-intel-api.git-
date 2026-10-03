import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asLineTotal,
  asMarkupRatio,
  asPerUnitCost,
  deriveMarkup,
  lineCost,
  moneyDiffers,
  withMarkup,
} from "./money.ts";

describe("money helpers", () => {
  it("extends per-unit cost to a line total", () => {
    // asPerUnitCost rounds to cents first (12.345 → 12.35), then × qty.
    assert.equal(lineCost(asPerUnitCost(12.345), 10), asLineTotal(123.5));
    assert.equal(lineCost(asPerUnitCost(12.34), 10), asLineTotal(123.4));
  });

  it("normalizes percent markup > 1 into a ratio", () => {
    assert.equal(asMarkupRatio(15), 0.15);
  });

  it("applies markup and derives it back", () => {
    const cost = asLineTotal(1000);
    const price = withMarkup(cost, asMarkupRatio(0.2));
    assert.equal(price, asLineTotal(1200));
    assert.equal(deriveMarkup(price, cost), asMarkupRatio(0.2));
  });

  it("ignores sub-cent money drift", () => {
    assert.equal(moneyDiffers(1.001, 1.004), false);
    assert.equal(moneyDiffers(1.0, 1.01), true);
  });
});
