import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";
import { buildEstimateApprovalPayload } from "./estimate-approval";

const version = {
  id: "version-1", estimate_id: "estimate-1", project_id: "project-1", row_version: 4,
  status: "draft", contingency_pct: 5, overhead_pct: 10, profit_pct: 15,
};
const item = {
  id: "item-1", description: "Concrete slab", csi_code: "03-30-00", quantity: 100, uom: "SF",
  unit_price: 12, total_direct_cost: 900, indirect_cost: 0, contingency: 45, overhead: 94.5,
  profit: 155.93, total_price: 1195.43, pricing_status: "priced", source_takeoff_id: "takeoff-1",
  quantity_basis: "Measured area", drawing_ref: "S-101", location_tag: "Level 1",
  price_observation_id: "price-1", price_source_snapshot: { approval_status: "approved", source_kind: "project_quote", effective_date: "2026-08-01" },
  is_alternate: false, alternate_accepted: false,
};

describe("estimate approval payload", () => {
  it("is approval-ready only with quantity and approved price provenance", () => {
    const payload = buildEstimateApprovalPayload(version, [item]);
    assert.equal(payload.quality.ready_for_proposal, true);
    assert.equal(payload.versionRevision, 4);
  });

  it("changes its immutable hash when a quantity or price changes", () => {
    const first = buildEstimateApprovalPayload(version, [item]);
    const changed = buildEstimateApprovalPayload(version, [{ ...item, quantity: 101 }]);
    assert.notEqual(hashApprovalPayload(first), hashApprovalPayload(changed));
  });

  it("blocks manual pricing without a governed price source", () => {
    const payload = buildEstimateApprovalPayload(version, [{
      ...item, pricing_status: "manual", price_observation_id: null, price_source_snapshot: null,
    }]);
    assert.equal(payload.quality.ready_for_proposal, false);
  });
});
