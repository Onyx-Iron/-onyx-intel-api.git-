import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EstimateQualityReport } from "../estimating/estimate-qc.ts";
import {
  buildProjectStatusContext,
  statusReportIncludesFinancials,
  type ProjectStatusContextInput,
} from "./project-status.ts";

function quality(grandTotal: number): EstimateQualityReport {
  return {
    totals: {
      grand_total: grandTotal,
      by_type: { Labor: grandTotal },
      by_csi_division: {},
      by_trade: {},
    },
    counts: {
      total_items: 4,
      source_backed: 3,
      manual_items: 1,
      priced: 2,
      unpriced: 1,
      review: 1,
      missing_evidence: 1,
      missing_quantity: 0,
      missing_unit_cost: 1,
    },
    blockers: ["1 estimate item needs unit pricing"],
    audit_items: [],
    risk_score: 22,
    ready_for_proposal: false,
  };
}

function contextInput(includeFinancials: boolean, budget: number | null = 1842750): ProjectStatusContextInput {
  return {
    project: {
      id: "p1",
      name: "River School",
      status: "active",
      budget,
      start_date: "2026-03-01",
      end_date: null,
      city: "Austin",
      state: "TX",
    },
    includeFinancials,
    taskRows: [{ status: "complete" }, { status: "active" }, { status: "completed" }],
    estimateQuality: quality(654321.6),
    punchRows: [{ description: "Paint touch-up", status: "open", priority: "high" }],
    permitRows: [{ permit_type: "building", status: "issued" }],
    procurementRows: [{ description: "Pipe", status: "ordered", required_date: "2026-04-15" }],
    logRows: [
      { log_date: "2026-03-02", work_performed: "Formed slab", crew_count: 6, weather: "rain" },
      { log_date: "2026-03-03", work_performed: null, crew_count: null, weather: null },
    ],
    rfiRows: [{ number: null, subject: "Ceiling height", status: "open", priority: "high", due_date: "2026-04-01" }],
    submittalRows: [{ number: "SUB-1", title: "Paint", status: "revise_resubmit", due_date: "2026-05-01", responsible: "Architect" }],
    changeOrderRows: [
      { number: "CO-4", description: "Added canopy", status: "approved", amount: 90210 },
      { number: null, description: "Credit fixture", status: "pending", amount: 0 },
      { number: "CO-5", description: "Clarification", status: "pending", amount: null },
    ],
  };
}

describe("status report financials", () => {
  it("shows prices unless the caller explicitly hides them", () => {
    assert.equal(statusReportIncludesFinancials(undefined), true);
    assert.equal(statusReportIncludesFinancials({}), true);
    assert.equal(statusReportIncludesFinancials({ includeFinancials: true }), true);
    assert.equal(statusReportIncludesFinancials({ includeFinancials: false }), false);
  });

  it("keeps budget, estimate, and change-order dollars out of a restricted prompt", () => {
    const hidden = buildProjectStatusContext(contextInput(false));
    assert.match(hidden.context, /Say that pricing is hidden/);
    assert.match(hidden.context, /Budget and estimate dollars are omitted for this reader/);
    assert.equal(hidden.context.includes("$"), false);
    assert.equal(hidden.context.includes("1842750"), false);
    assert.equal(hidden.context.includes("90210"), false);
    assert.equal(hidden.context.includes("654322"), false);
    assert.match(hidden.context, /CO-4 \[approved\] Added canopy/);
    assert.equal(/Added canopy,/.test(hidden.context), false);
    assert.match(hidden.context, /\[pending\] Credit fixture/);
    assert.match(hidden.context, /CO-5 \[pending\] Clarification/);
    assert.equal(hidden.completion, 33);
    assert.equal(hidden.estimateValue, 654322);
  });

  it("includes rounded prices for a reader who can price the bid", () => {
    const shown = buildProjectStatusContext(contextInput(true));
    const budget = (1842750).toLocaleString();
    const estimate = (654322).toLocaleString();
    const change = (90210).toLocaleString();
    assert.equal(shown.context.includes("Say that pricing is hidden"), false);
    assert.ok(shown.context.includes(`Budget: $${budget} | Estimated cost so far: $${estimate}`));
    assert.ok(shown.context.includes(`Added canopy, $${change}`));
    assert.ok(shown.context.includes("Credit fixture, $0"));
    assert.equal(/Clarification, \$/.test(shown.context), false);
    assert.equal(shown.estimateValue, 654322);
  });

  it("says the budget is unset without inventing a zero", () => {
    const shown = buildProjectStatusContext(contextInput(true, null));
    assert.match(shown.context, /Budget: not set \| Estimated cost so far:/);
  });

  it("keeps schedule, field, and open-item facts when prices are hidden", () => {
    const { context } = buildProjectStatusContext(contextInput(false));
    assert.match(context, /PROJECT: River School \(Austin, TX\)/);
    assert.match(context, /Status: active \| Timeline: 2026-03-01 -> TBD/);
    assert.match(context, /Schedule: 1\/3 tasks complete \(33%\)/);
    assert.match(context, /not ready for proposal \| Risk score: 22\/100 \| Source-backed: 3\/4/);
    assert.match(context, /Estimate blocker: 1 estimate item needs unit pricing/);
    assert.match(context, /\[high\/open\] Paint touch-up/);
    assert.match(context, /RFI \[high\/open\] Ceiling height, due 2026-04-01/);
    assert.match(context, /SUB-1 \[revise_resubmit\] Paint, Architect, due 2026-05-01/);
    assert.match(context, /building: issued/);
    assert.match(context, /Pipe \(ordered, needed 2026-04-15\)/);
    assert.match(context, /2026-03-02 \(rain, 6 crew\): Formed slab/);
    assert.match(context, /2026-03-03 \(\?, \? crew\): no description/);
  });

  it("uses a placeholder location and only counts status complete", () => {
    const input = contextInput(false);
    input.project = { ...input.project, city: null, state: null };
    input.taskRows = [];
    const { context, completion } = buildProjectStatusContext(input);
    assert.match(context, /River School \(location n\/a\)/);
    assert.match(context, /Schedule: 0\/0 tasks complete \(0%\)/);
    assert.equal(completion, 0);
  });

  it("prints the first twenty punch items and still counts the rest", () => {
    const input = contextInput(true);
    input.punchRows = Array.from({ length: 21 }, (_, index) => ({
      description: `Punch ${index + 1}`,
      status: "open",
      priority: "high",
    }));
    const { context } = buildProjectStatusContext(input);
    assert.match(context, /OPEN PUNCH ITEMS \(21\)/);
    assert.match(context, /Punch 20/);
    assert.equal(context.includes("Punch 21"), false);
  });
});
