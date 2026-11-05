import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEstimateQualityReport } from "@/lib/estimating/estimate-qc.ts";
import { buildProjectStatusPrompt, type ProjectStatusPromptInput } from "./project-status.ts";

const BUDGET = 2_500_000;
const UNIT_COST = 125_000;
const CHANGE_AMOUNT = 48_000;

function input(includeFinancials: boolean): ProjectStatusPromptInput {
  return {
    includeFinancials,
    project: {
      id: "project-1",
      name: "River Park",
      status: "active",
      budget: BUDGET,
      start_date: "2026-01-06",
      end_date: null,
      city: "Austin",
      state: "TX",
    },
    tasks: [
      { status: "complete" },
      { status: "open" },
      { status: "in_progress" },
    ],
    estimateQuality: buildEstimateQualityReport([{
      description: "Concrete",
      quantity: 10,
      unit_cost: UNIT_COST,
      pricing_status: "priced",
      csi_code: "03 30 00",
      trade: "Concrete",
      item_type: "material",
      quantity_basis: "takeoff",
      drawing_ref: "S1",
      location_tag: "Level 1",
    }]),
    punchRows: [{ description: "Patch stair nosing", status: "open", priority: "high" }],
    permitRows: [{ permit_type: "building", status: "submitted" }],
    procurementRows: [{ description: "Rebar", status: "ordered", required_date: "2026-11-12" }],
    logRows: [{ log_date: "2026-11-04", work_performed: "Poured deck", crew_count: 8, weather: "clear" }],
    rfiRows: [{ number: "RFI-12", subject: "Slab joint", status: "open", priority: "high", due_date: "2026-11-10" }],
    submittalRows: [{ number: "S-4", title: "Mix design", status: "under_review", due_date: null, responsible: "GC" }],
    changeOrderRows: [{ number: "CO-3", description: "Added ramp", status: "approved", amount: String(CHANGE_AMOUNT) }],
  };
}

function moneyFragments(): string[] {
  return [BUDGET, UNIT_COST * 10, CHANGE_AMOUNT].flatMap((amount) => [
    String(amount),
    amount.toLocaleString(),
  ]);
}

describe("buildProjectStatusPrompt", () => {
  it("keeps budget, estimate, and change-order dollars out of a restricted reader's prompt", () => {
    const built = buildProjectStatusPrompt(input(false));

    assert.equal(built.completion, 33);
    assert.equal(built.estimateValue, UNIT_COST * 10);
    assert.match(built.prompt, /Do not state budget, estimate, change-order/);
    assert.match(built.prompt, /Budget and estimate dollars are omitted/);
    assert.match(built.prompt, /Schedule: 1\/3 tasks complete \(33%\)/);
    assert.match(built.prompt, /Patch stair nosing/);
    assert.match(built.prompt, /RFI-12 \[high\/open\] Slab joint, due 2026-11-10/);
    assert.match(built.prompt, /CO-3 \[approved\] Added ramp$/m);
    assert.equal(built.prompt.includes("$"), false);
    for (const fragment of moneyFragments()) {
      assert.equal(built.prompt.includes(fragment), false, fragment);
    }
  });

  it("includes the same dollars when the reader can price the job", () => {
    const built = buildProjectStatusPrompt(input(true));

    assert.match(built.prompt, new RegExp(`Budget: \\$${BUDGET.toLocaleString()}`));
    assert.match(built.prompt, new RegExp(`Estimated cost so far: \\$${(UNIT_COST * 10).toLocaleString()}`));
    assert.match(built.prompt, new RegExp(`Added ramp, \\$${CHANGE_AMOUNT.toLocaleString()}`));
    assert.equal(built.prompt.includes("pricing is hidden"), false);
  });

  it("reports an empty schedule as zero percent and an unset budget as not set", () => {
    const empty = input(true);
    empty.tasks = [];
    empty.project = { ...empty.project, budget: null };
    empty.changeOrderRows = [{ number: null, description: "Credit", status: "pending", amount: null }];
    const built = buildProjectStatusPrompt(empty);

    assert.equal(built.completion, 0);
    assert.match(built.prompt, /Schedule: 0\/0 tasks complete \(0%\)/);
    assert.match(built.prompt, /Budget: not set \|/);
    assert.match(built.prompt, /CO \[pending\] Credit$/m);
    assert.equal(built.prompt.includes("Credit, $"), false);
  });
});
