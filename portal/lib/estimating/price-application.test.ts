import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveApprovedPriceApplication } from "./price-application";

const observation = {
  id: "price-1", tenant_id: "tenant-1", project_id: "project-1", cost_code: "03-30-00",
  description: "Quoted slab placement", source_kind: "project_quote", source_ref: "Q-100",
  effective_date: "2026-08-01", expires_at: null, unit: "SF", currency: "USD",
  labor_cost: 2, material_cost: 7, equipment_cost: 1, subcontract_cost: 0, other_cost: 0.25,
  tax_cost: 0.5, freight_cost: 0.25, waste_cost: 0.5, escalation_cost: 0,
  confidence: 1, approval_status: "approved", approved_by: "reviewer", approved_at: "2026-08-02T00:00:00Z",
};

describe("approved price application", () => {
  it("recomputes item costs from the approved per-unit source", () => {
    const result = resolveApprovedPriceApplication({
      projectId: "project-1", costCode: "03-30-00", quantity: 100, unit: "SF",
      percentages: { contingencyPct: 5, overheadPct: 10, profitPct: 15 },
      asOfDate: "2026-08-14",
    }, observation);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.patch.labor_cost, 200);
      assert.equal(result.patch.material_cost, 700);
      assert.equal(result.patch.other_direct_cost, 150);
      assert.equal(result.patch.pricing_status, "priced");
      assert.equal(result.patch.price_observation_id, "price-1");
    }
  });

  it("rejects provisional AI, stale, other-project, and unit-mismatched evidence", () => {
    const input = {
      projectId: "project-1", costCode: "03-30-00", quantity: 100, unit: "SF",
      percentages: {}, asOfDate: "2026-08-14",
    };
    assert.equal(resolveApprovedPriceApplication(input, { ...observation, source_kind: "ai_estimate" }).valid, false);
    assert.equal(resolveApprovedPriceApplication(input, { ...observation, expires_at: "2026-08-13" }).valid, false);
    assert.equal(resolveApprovedPriceApplication(input, { ...observation, project_id: "project-2" }).valid, false);
    assert.equal(resolveApprovedPriceApplication(input, { ...observation, unit: "CY" }).valid, false);
  });
});
