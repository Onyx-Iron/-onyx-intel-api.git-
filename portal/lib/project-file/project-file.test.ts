import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CpmCycleError, computeCpm, shiftTaskDates } from "./cpm.ts";
import {
  approvedChangeDelta,
  computeBudgetLine,
  computePayLine,
  eventPostsBudget,
  waiverCoversDraw,
} from "./money.ts";
import {
  approvedRfiWritesTo,
  buildProjectBrief,
  clientCanSeeChangeEvent,
  clientCanSeeDailyLog,
  mutationForAgentDecision,
  pinCreatesTakeoff,
  remainingQuantity,
  sheetPinInsert,
  subCanSeeRecord,
} from "./records.ts";

describe("schedule CPM", () => {
  it("marks a finish-to-start chain and the critical path", () => {
    const results = computeCpm([
      { id: "a", duration: 3, deps: [] },
      { id: "b", duration: 2, deps: ["a"] },
      { id: "c", duration: 1, deps: [] },
    ]);
    const byId = Object.fromEntries(results.map((row) => [row.id, row]));
    assert.equal(byId.a.es, 0);
    assert.equal(byId.a.ef, 3);
    assert.equal(byId.b.es, 3);
    assert.equal(byId.b.ef, 5);
    assert.equal(byId.b.critical, true);
    assert.equal(byId.c.total_float, 4);
    assert.equal(byId.c.critical, false);
  });

  it("rejects a dependency cycle", () => {
    assert.throws(
      () => computeCpm([
        { id: "a", duration: 1, deps: ["b"] },
        { id: "b", duration: 1, deps: ["a"] },
      ]),
      CpmCycleError,
    );
  });

  it("shifts calendar dates by whole days", () => {
    assert.deepEqual(
      shiftTaskDates({ start_date: "2026-10-01", end_date: "2026-10-05" }, 10),
      { start_date: "2026-10-11", end_date: "2026-10-15" },
    );
  });
});

describe("project cost math", () => {
  it("keeps draft and pending change orders out of the revised budget", () => {
    assert.equal(approvedChangeDelta("draft", "pending", 5000), 0);
    assert.equal(approvedChangeDelta("pending", "draft", 5000), 0);
    assert.equal(approvedChangeDelta("pending", "approved", 5000), 5000);
    assert.equal(approvedChangeDelta("approved", "approved", 5000), 0);
    assert.equal(eventPostsBudget("draft"), false);
    assert.equal(eventPostsBudget("approved"), true);
  });

  it("forecasts the remainder unless a line override is set", () => {
    const computed = computeBudgetLine({
      original: 1000,
      approvedChange: 200,
      committed: 400,
      actual: 300,
      forecastOverride: null,
    });
    assert.equal(computed.revised, 1200);
    assert.equal(computed.forecastToComplete, 500);
    assert.equal(computed.projectedFinal, 1200);
    assert.equal(computed.projectedMargin, 0);

    const overridden = computeBudgetLine({
      original: 1000,
      approvedChange: 0,
      committed: 0,
      actual: 100,
      forecastOverride: 50,
    });
    assert.equal(overridden.forecastToComplete, 50);
    assert.equal(overridden.projectedFinal, 150);
  });

  it("computes pay-app retainage and balance from the schedule of values", () => {
    const line = computePayLine({
      scheduledValue: 1000,
      previous: 200,
      thisPeriod: 300,
      storedMaterials: 100,
      retainagePct: 10,
    });
    assert.equal(line.completed, 600);
    assert.equal(line.retainage, 60);
    assert.equal(line.balance, 400);
  });

  it("holds a pay app until received lien waivers cover the draw", () => {
    assert.equal(waiverCoversDraw([{ status: "pending", amount: 500, draw_number: "1" }], "1", 500), false);
    assert.equal(waiverCoversDraw([{ status: "received", amount: 500, draw_number: "1" }], "1", 500), true);
    assert.equal(waiverCoversDraw([{ status: "received", amount: 100, draw_number: "1" }], "1", 500), false);
  });
});

describe("project file records", () => {
  it("does not turn a sheet pin into a takeoff", () => {
    const draft = {
      project_id: "p",
      page_id: "page",
      entity_type: "rfi" as const,
      entity_id: "e",
      x: 10,
      y: 20,
      label: "RFI",
    };
    const row = sheetPinInsert(draft, "t");
    assert.equal(pinCreatesTakeoff(draft), false);
    assert.equal("takeoff_type" in row, false);
    assert.equal("quantity" in row, false);
    assert.equal(row.entity_type, "rfi");
  });

  it("leaves remaining quantity as budget minus installed", () => {
    assert.equal(remainingQuantity(12, 5), 7);
    assert.equal(remainingQuantity(null, 5), null);
  });

  it("writes nothing when an agent decision is rejected", () => {
    assert.equal(mutationForAgentDecision("reject"), "none");
    assert.equal(mutationForAgentDecision("approve"), "write");
    assert.equal(approvedRfiWritesTo(), "rfi_items");
  });

  it("scopes client and sub views to this project file", () => {
    assert.equal(clientCanSeeDailyLog("ClientView", false), false);
    assert.equal(clientCanSeeDailyLog("ClientView", true), true);
    assert.equal(clientCanSeeChangeEvent("ClientView", "draft"), false);
    assert.equal(clientCanSeeChangeEvent("ClientView", "pending"), true);
    assert.equal(subCanSeeRecord({ role: "Subcontractor", contactId: "c1" }, "c1"), true);
    assert.equal(subCanSeeRecord({ role: "Subcontractor", contactId: "c1" }, "c2"), false);
    assert.equal(subCanSeeRecord({ role: "Subcontractor", contactId: null }, "c1"), false);
  });

  it("builds a project brief that stays inside the file", () => {
    const lines = buildProjectBrief({
      projectId: "proj",
      today: "2026-10-04",
      balls: [{
        id: "1",
        kind: "rfi",
        label: "Invert elevation",
        due_date: "2026-10-01",
        ball_contact_id: "c",
        status: "open",
      }],
      submittals: [{
        id: "s",
        title: "Pipe",
        status: "submitted",
        due_date: "2026-10-20",
        blocksTaskStart: "2026-10-10",
      }],
      payApps: [{ id: "pa", number: "1", waiverCovered: false, status: "draft" }],
      tasksWithoutProduction: [{ id: "t", name: "Install pipe" }],
    });
    assert.equal(lines.length, 4);
    assert.ok(lines.every((line) => line.href.includes("/dashboard/projects/proj?")));
  });
});
