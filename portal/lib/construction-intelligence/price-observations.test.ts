import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePriceObservationInput } from "./price-observations";

const valid = {
  project_id: "11111111-1111-4111-8111-111111111111",
  trade_key: "concrete",
  cost_code: "03-30-00",
  description: "Ready-mix concrete, 4,000 PSI",
  source_kind: "project_quote",
  source_ref: "quote://supplier/Q-1042",
  effective_date: "2026-08-13",
  state_code: "TX",
  metro_code: "DFW",
  postal_code: "75201",
  unit: "CY",
  labor_cost: 12,
  material_cost: 150,
  equipment_cost: 8,
  confidence: 0.9,
  assumptions: ["Daytime placement"],
};

describe("price observation ingestion", () => {
  it("forces submitted evidence into human review", () => {
    const parsed = parsePriceObservationInput({ ...valid, approval_status: "approved" });
    assert.equal(parsed.approval_status, "unreviewed");
    assert.equal(parsed.material_cost, 150);
  });

  it("requires traceable provenance for non-AI sources", () => {
    assert.throws(() => parsePriceObservationInput({ ...valid, source_ref: "" }), /source reference/i);
  });

  it("requires project quotes to belong to a project", () => {
    assert.throws(() => parsePriceObservationInput({ ...valid, project_id: null }), /project quote/i);
  });

  it("rejects observations without a positive cost component", () => {
    assert.throws(() => parsePriceObservationInput({ ...valid, labor_cost: 0, material_cost: 0, equipment_cost: 0 }), /positive cost/i);
  });
});
