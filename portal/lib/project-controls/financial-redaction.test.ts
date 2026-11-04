import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EstimateQualityReport } from "../estimating/estimate-qc.ts";
import { overviewMoneyForReader, redactAuditSnapshot, redactEstimateQuality, redactReportSummary } from "./financial-redaction";

describe("overview money for restricted readers", () => {
  const money = {
    estimate_value: 1250000,
    pending_change_order_value: 48000,
    approved_change_order_value: 12000,
  };

  it("keeps the dollars for a role that can read financials", () => {
    assert.deepEqual(overviewMoneyForReader(true, money), money);
  });

  it("nulls estimate and change-order dollars for a restricted role", () => {
    assert.deepEqual(overviewMoneyForReader(false, money), {
      estimate_value: null,
      pending_change_order_value: null,
      approved_change_order_value: null,
    });
  });
});

describe("audit snapshots", () => {
  it("nulls budget and line prices for a restricted reader", () => {
    const snapshot = redactAuditSnapshot({ name: "Site", budget: 250000, unit_cost: 12.5 }, false);
    assert.deepEqual(snapshot, { name: "Site", budget: null, unit_cost: null });
  });

  it("nulls pay, bid, and purchase-order amounts for a restricted reader", () => {
    const snapshot = redactAuditSnapshot({
      name: "Ada",
      hourly_rate: 85,
      bid_value: 250000,
      total_amount: 900,
      equipment_cost: 40,
    }, false);
    assert.deepEqual(snapshot, {
      name: "Ada",
      hourly_rate: null,
      bid_value: null,
      total_amount: null,
      equipment_cost: null,
    });
  });

  it("leaves a readable snapshot and non-objects untouched", () => {
    const snapshot = { hourly_rate: 85, note: "ok" };
    assert.equal(redactAuditSnapshot(snapshot, true), snapshot);
    assert.equal(redactAuditSnapshot(null, false), null);
    assert.equal(redactAuditSnapshot("250000", false), "250000");
  });
});

describe("estimate quality for restricted readers", () => {
  it("drops sell-price rollups and line totals", () => {
    const quality: EstimateQualityReport = {
      totals: {
        grand_total: 48250.5,
        by_type: { Labor: 10000 },
        by_csi_division: { "Division 03": 20000 },
        by_trade: { Concrete: 48250.5 },
      },
      counts: {
        total_items: 2,
        source_backed: 1,
        manual_items: 1,
        priced: 1,
        unpriced: 1,
        review: 0,
        missing_evidence: 0,
        missing_quantity: 0,
        missing_unit_cost: 1,
      },
      blockers: ["1 estimate item needs unit pricing"],
      audit_items: [
        { id: "line-1", description: "Slab", total: 48250.5, reasons: ["Needs unit pricing"] },
      ],
      risk_score: 30,
      ready_for_proposal: false,
    };

    const redacted = redactEstimateQuality(quality);

    assert.equal(redacted.totals, null);
    assert.equal(quality.totals.grand_total, 48250.5);
    assert.equal(quality.audit_items[0].total, 48250.5);
    assert.deepEqual(redacted.audit_items, [
      { id: "line-1", description: "Slab", reasons: ["Needs unit pricing"] },
    ]);
    assert.equal("total" in redacted.audit_items[0], false);
    assert.equal(redacted.risk_score, 30);
    assert.equal(redacted.ready_for_proposal, false);
    assert.deepEqual(redacted.blockers, quality.blockers);
    assert.deepEqual(redacted.counts, quality.counts);
  });
});

describe("stored report summary", () => {
  it("nulls estimate_value and leaves completion", () => {
    const summary = redactReportSummary({ completion: 40, estimate_value: 90000, risk_score: 12 }, false);
    assert.deepEqual(summary, { completion: 40, estimate_value: null, risk_score: 12 });
  });
});
