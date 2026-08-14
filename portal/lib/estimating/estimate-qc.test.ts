import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEstimateQualityReport } from "./estimate-qc.ts";

describe("estimate quality report", () => {
  it("never approves an empty estimate", () => {
    const report = buildEstimateQualityReport([]);
    assert.equal(report.ready_for_proposal, false);
    assert.match(report.blockers.join("\n"), /no line items/i);
  });

  it("rolls up priced source-backed rows and marks clean estimates proposal-ready", () => {
    const report = buildEstimateQualityReport([
      {
        id: "item-1",
        description: "4 inch sanitary pipe",
        csi_code: "22-13-16",
        trade: "Plumbing",
        item_type: "material",
        quantity: 125,
        unit_cost: 42.5,
        source_takeoff_id: "takeoff-1",
        source_fingerprint: "pipe|22-13-16|125|lf|p2.1|building a",
        quantity_basis: "Measured polyline on P2.1",
        drawing_ref: "P2.1",
        pricing_status: "priced",
        price_observation_id: "price-1",
        price_approval_status: "approved",
      },
    ]);

    assert.equal(report.totals.grand_total, 5312.5);
    assert.deepEqual(report.totals.by_type, { material: 5312.5 });
    assert.deepEqual(report.totals.by_csi_division, { "Division 22": 5312.5 });
    assert.deepEqual(report.totals.by_trade, { Plumbing: 5312.5 });
    assert.equal(report.counts.source_backed, 1);
    assert.equal(report.ready_for_proposal, true);
    assert.equal(report.risk_score, 0);
    assert.deepEqual(report.blockers, []);
  });

  it("flags unpriced, review, and missing evidence rows as blockers", () => {
    const report = buildEstimateQualityReport([
      {
        id: "item-1",
        description: "AI counted luminaires",
        csi_code: "26-51-00",
        trade: "Electrical",
        item_type: "material",
        quantity: 14,
        unit_cost: 325,
        source_takeoff_id: "takeoff-ai",
        source_fingerprint: "lights|26-51-00|14|ea|e-201|",
        drawing_ref: "E-201",
        pricing_status: "review",
      },
      {
        id: "item-2",
        description: "Domestic water pipe",
        csi_code: "22-11-16",
        trade: "Plumbing",
        item_type: "material",
        quantity: 80,
        unit_cost: null,
        source_takeoff_id: "takeoff-2",
        source_fingerprint: "pipe|22-11-16|80|lf||",
        pricing_status: "unpriced",
      },
    ]);

    assert.equal(report.ready_for_proposal, false);
    assert.equal(report.counts.review, 1);
    assert.equal(report.counts.unpriced, 1);
    assert.equal(report.counts.missing_evidence, 1);
    assert.equal(report.counts.missing_unit_cost, 1);
    assert.match(report.blockers.join("\n"), /need unit pricing/);
    assert.match(report.blockers.join("\n"), /require estimator review/);
    assert.match(report.blockers.join("\n"), /missing drawing, location, or quantity basis evidence/);
    assert.equal(report.audit_items.length, 2);
  });

  it("blocks manual pricing without approved price evidence", () => {
    const report = buildEstimateQualityReport([
      {
        id: "manual-1",
        description: "Estimator allowance",
        csi_code: "01-21-00",
        trade: "General Conditions",
        item_type: "allowance",
        quantity: 1,
        unit_cost: 5000,
        pricing_status: "manual",
      },
    ]);

    assert.equal(report.counts.manual_items, 1);
    assert.equal(report.counts.priced, 0);
    assert.equal(report.ready_for_proposal, false);
    assert.equal(report.counts.missing_price_evidence, 1);
    assert.match(report.blockers.join("\n"), /approved price evidence/);
  });

  it("flags missing quantities even when a unit cost exists", () => {
    const report = buildEstimateQualityReport([
      {
        id: "bad-qty",
        description: "Panelboard",
        csi_code: "26-24-16",
        trade: "Electrical",
        item_type: "material",
        quantity: 0,
        unit_cost: 1200,
        source_takeoff_id: "takeoff-3",
        quantity_basis: "Counted schedule rows",
        pricing_status: "priced",
      },
    ]);

    assert.equal(report.totals.grand_total, 0);
    assert.equal(report.counts.missing_quantity, 1);
    assert.equal(report.ready_for_proposal, false);
    assert.match(report.audit_items[0].reasons.join(", "), /Missing or zero quantity/);
  });
});
