import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyVersionPercentages, calculateEstimateTotals, calculateItem,
  computeCostBeforeProfit, computeDirectCost, computeMargin, computeMarkup, computeSellingPrice, priceItemAtVersionPercentages, roundCurrency,
} from "./calculations";

describe("cost calculations", () => {
  it("direct cost sums every cost category", () => {
    const direct = computeDirectCost({
      laborCost: 100, materialCost: 200, equipmentCost: 50, truckingCost: 25,
      subcontractCost: 300, disposalCost: 10, testingCost: 5, otherDirectCost: 15,
    });
    assert.equal(direct, 705);
  });

  it("cost before profit adds indirect, contingency, and overhead to direct cost", () => {
    assert.equal(computeCostBeforeProfit(1000, 100, 50, 75), 1225);
  });

  it("selling price adds profit to cost before profit", () => {
    assert.equal(computeSellingPrice(1225, 200), 1425);
  });

  it("markup is profit divided by cost before profit (not selling price)", () => {
    // $200 profit on $1000 cost-before-profit = 20% markup
    assert.equal(computeMarkup(200, 1000), 0.2);
  });

  it("margin is profit divided by selling price (not cost before profit)", () => {
    // $200 profit on $1200 selling price = ~16.67% margin — a DIFFERENT
    // number from the 20% markup above, proving the two are never conflated.
    const margin = computeMargin(200, 1200);
    assert.ok(margin !== null);
    assert.ok(Math.abs(margin - 0.16666666) < 0.0001);
  });

  it("markup and margin are never equal for a non-zero profit — proves they use different denominators", () => {
    const profit = 300;
    const costBeforeProfit = 1000;
    const sellingPrice = costBeforeProfit + profit; // 1300
    const markup = computeMarkup(profit, costBeforeProfit);
    const margin = computeMargin(profit, sellingPrice);
    assert.notEqual(markup, margin);
    assert.equal(markup, 0.3);
    assert.ok(margin !== null && Math.abs(margin - 0.230769) < 0.0001);
  });

  it("zero-cost behavior: markup is null (undefined), not 0, when cost before profit is zero", () => {
    assert.equal(computeMarkup(50, 0), null);
  });

  it("zero-revenue behavior: margin is null (undefined), not 0, when selling price is zero", () => {
    assert.equal(computeMargin(50, 0), null);
  });

  it("zero-cost AND zero-profit: markup/margin are still null, not NaN or 0/0", () => {
    assert.equal(computeMarkup(0, 0), null);
    assert.equal(computeMargin(0, 0), null);
  });

  it("rounding: currency rounds to the nearest cent using standard rounding, not truncation", () => {
    assert.equal(roundCurrency(10.005), 10.01); // would truncate to 10.00 without epsilon correction
    assert.equal(roundCurrency(10.004), 10.0);
    assert.equal(roundCurrency(-5.005), -5); // negative values don't get pulled the wrong direction
  });

  it("calculateItem derives unit_price by dividing total_price by quantity", () => {
    const result = calculateItem({
      laborCost: 100, materialCost: 100, quantity: 10,
      indirectCost: 0, contingency: 20, overhead: 20, profit: 20,
    });
    assert.equal(result.totalDirectCost, 200);
    assert.equal(result.totalPrice, 260);
    assert.equal(result.unitPrice, 26);
  });

  it("calculateItem returns a null unit_price when quantity is zero (never divides by zero)", () => {
    const result = calculateItem({ laborCost: 100, quantity: 0 });
    assert.equal(result.unitPrice, null);
  });

  it("applyVersionPercentages cascades direct -> +contingency -> *overhead -> *profit, matching the legacy matrix formula", () => {
    // direct=1000, contingency 5% -> 1050, overhead 10% -> 1155, profit 15% of 1155 -> 173.25
    const { contingency, overhead, profit } = applyVersionPercentages(1000, 0, { contingencyPct: 5, overheadPct: 10, profitPct: 15 });
    assert.equal(contingency, 50);
    assert.equal(overhead, 105); // 10% of (1000+50)
    assert.equal(profit, 173.25); // 15% of (1000+50+105)
  });
});

describe("estimate-level roll-up", () => {
  it("sums direct/indirect/contingency/overhead/profit/total across all items", () => {
    const totals = calculateEstimateTotals([
      { totalDirectCost: 1000, indirectCost: 50, contingency: 50, overhead: 100, profit: 150, totalPrice: 1350 },
      { totalDirectCost: 2000, indirectCost: 100, contingency: 100, overhead: 200, profit: 300, totalPrice: 2700 },
    ]);
    assert.equal(totals.totalDirectCost, 3000);
    assert.equal(totals.totalIndirectCost, 150);
    assert.equal(totals.totalContingency, 150);
    assert.equal(totals.totalOverhead, 300);
    assert.equal(totals.totalProfit, 450);
    assert.equal(totals.totalPrice, 4050);
  });

  it("excludes alternates from the total unless explicitly accepted", () => {
    const totals = calculateEstimateTotals([
      { totalDirectCost: 1000, indirectCost: 0, contingency: 0, overhead: 0, profit: 0, totalPrice: 1000, isAlternate: false },
      { totalDirectCost: 500, indirectCost: 0, contingency: 0, overhead: 0, profit: 0, totalPrice: 500, isAlternate: true, alternateAccepted: false },
    ]);
    assert.equal(totals.totalPrice, 1000, "unaccepted alternate must not affect the total");
  });

  it("includes an alternate once it is accepted", () => {
    const totals = calculateEstimateTotals([
      { totalDirectCost: 1000, indirectCost: 0, contingency: 0, overhead: 0, profit: 0, totalPrice: 1000, isAlternate: false },
      { totalDirectCost: 500, indirectCost: 0, contingency: 0, overhead: 0, profit: 0, totalPrice: 500, isAlternate: true, alternateAccepted: true },
    ]);
    assert.equal(totals.totalPrice, 1500);
  });

  it("applies version markup to a line's direct cost", () => {
    const priced = priceItemAtVersionPercentages(
      { materialCost: 1000, quantity: 10 },
      { contingencyPct: 5, overheadPct: 10, profitPct: 15 },
    );
    assert.equal(priced.totalDirectCost, 1000);
    assert.equal(priced.contingency, 50);
    assert.equal(priced.overhead, 105);
    assert.equal(priced.profit, 173.25);
    assert.equal(priced.totalPrice, 1328.25);
    assert.ok(priced.unitPrice != null);
    assert.ok(Math.abs(priced.unitPrice - priced.totalPrice / 10) < 0.01);
  });

  it("an empty item list produces all-zero totals with null markup/margin, not NaN", () => {
    const totals = calculateEstimateTotals([]);
    assert.equal(totals.totalPrice, 0);
    assert.equal(totals.markup, null);
    assert.equal(totals.margin, null);
  });
});
