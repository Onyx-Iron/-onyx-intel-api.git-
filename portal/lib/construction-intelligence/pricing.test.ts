import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePricing, comparePriceSources, priceFromMargin, selectPriceObservation } from "./pricing";

describe("construction intelligence pricing", () => {
  it("keeps margin and markup mathematically distinct", () => {
    assert.equal(priceFromMargin(80, 0.2), 100);
    const result = calculatePricing({ labor: 80, material: 0, equipment: 0, subcontract: 0, targetMarginRate: 0.2 });
    assert.equal(result.targetSellPrice, 100);
    assert.equal(result.expectedMarginRate, 0.2);
    assert.equal(result.markupRate, 0.25);
  });

  it("never recommends below the profitability floor", () => {
    const result = calculatePricing({ labor: 100, material: 100, equipment: 0, subcontract: 0, targetMarginRate: 0.1, minimumMarginRate: 0.2, competitiveLowFactor: 0.5 });
    assert.equal(result.targetSellPrice, 250);
    assert.equal(result.competitiveLow, result.minimumAcceptablePrice);
  });

  it("orders evidence sources from strongest to weakest", () => {
    assert.ok(comparePriceSources("project_quote", "ai_estimate") < 0);
  });

  it("selects the strongest eligible evidence before considering locality or freshness", () => {
    const selected = selectPriceObservation([
      { id: "local", sourceKind: "local_market", approvalStatus: "approved", effectiveDate: "2026-08-10", expiresAt: null, projectId: null, postalCode: "75201", metroCode: "DAL", stateCode: "TX", confidence: 0.95 },
      { id: "quote", sourceKind: "project_quote", approvalStatus: "approved", effectiveDate: "2026-07-01", expiresAt: null, projectId: "11111111-1111-1111-1111-111111111111", postalCode: null, metroCode: null, stateCode: "TX", confidence: 0.8 },
    ], { projectId: "11111111-1111-1111-1111-111111111111", postalCode: "75201", metroCode: "DAL", stateCode: "TX", asOfDate: "2026-08-13" });

    assert.equal(selected?.observation.id, "quote");
    assert.equal(selected?.authoritative, true);
    assert.equal(selected?.provisionalReason, null);
  });

  it("excludes expired, future, rejected, and other-project observations", () => {
    const selected = selectPriceObservation([
      { id: "expired", sourceKind: "project_quote", approvalStatus: "approved", effectiveDate: "2026-01-01", expiresAt: "2026-08-12", projectId: "11111111-1111-1111-1111-111111111111", postalCode: null, metroCode: null, stateCode: "TX", confidence: 1 },
      { id: "future", sourceKind: "company_actual", approvalStatus: "approved", effectiveDate: "2026-08-14", expiresAt: null, projectId: null, postalCode: null, metroCode: null, stateCode: "TX", confidence: 1 },
      { id: "rejected", sourceKind: "historical_project", approvalStatus: "rejected", effectiveDate: "2026-08-01", expiresAt: null, projectId: null, postalCode: null, metroCode: null, stateCode: "TX", confidence: 1 },
      { id: "other-project", sourceKind: "project_quote", approvalStatus: "approved", effectiveDate: "2026-08-01", expiresAt: null, projectId: "22222222-2222-2222-2222-222222222222", postalCode: null, metroCode: null, stateCode: "TX", confidence: 1 },
      { id: "national", sourceKind: "licensed_dataset", approvalStatus: "approved", effectiveDate: "2026-06-01", expiresAt: null, projectId: null, postalCode: null, metroCode: null, stateCode: null, confidence: 0.7 },
    ], { projectId: "11111111-1111-1111-1111-111111111111", postalCode: "75201", metroCode: "DAL", stateCode: "TX", asOfDate: "2026-08-13" });

    assert.equal(selected?.observation.id, "national");
  });

  it("keeps AI and unreviewed evidence explicitly provisional", () => {
    const ai = selectPriceObservation([
      { id: "ai", sourceKind: "ai_estimate", approvalStatus: "approved", effectiveDate: "2026-08-13", expiresAt: null, projectId: null, postalCode: null, metroCode: null, stateCode: "TX", confidence: 0.9 },
    ], { stateCode: "TX", asOfDate: "2026-08-13" });
    const unreviewed = selectPriceObservation([
      { id: "market", sourceKind: "local_market", approvalStatus: "unreviewed", effectiveDate: "2026-08-13", expiresAt: null, projectId: null, postalCode: null, metroCode: null, stateCode: "TX", confidence: 0.9 },
    ], { stateCode: "TX", asOfDate: "2026-08-13" });

    assert.equal(ai?.authoritative, false);
    assert.equal(ai?.provisionalReason, "ai_estimate");
    assert.equal(unreviewed?.authoritative, false);
    assert.equal(unreviewed?.provisionalReason, "unreviewed");
  });

  it("does not let pending evidence displace an approved operational price", () => {
    const selected = selectPriceObservation([
      { id: "pending-quote", sourceKind: "project_quote", approvalStatus: "unreviewed", effectiveDate: "2026-08-13", expiresAt: null, projectId: "11111111-1111-1111-1111-111111111111", postalCode: null, metroCode: null, stateCode: "TX", confidence: 1 },
      { id: "approved-dataset", sourceKind: "licensed_dataset", approvalStatus: "approved", effectiveDate: "2026-08-01", expiresAt: null, projectId: null, postalCode: null, metroCode: null, stateCode: "TX", confidence: 0.8 },
    ], { projectId: "11111111-1111-1111-1111-111111111111", stateCode: "TX", asOfDate: "2026-08-13" });

    assert.equal(selected?.observation.id, "approved-dataset");
    assert.equal(selected?.authoritative, true);
  });
});
