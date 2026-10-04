import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overviewMoneyForReader, redactAuditSnapshot, redactReportSummary } from "./financial-redaction";

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
});

describe("stored report summary", () => {
  it("nulls estimate_value and leaves completion", () => {
    const summary = redactReportSummary({ completion: 40, estimate_value: 90000, risk_score: 12 }, false);
    assert.deepEqual(summary, { completion: 40, estimate_value: null, risk_score: 12 });
  });
});
