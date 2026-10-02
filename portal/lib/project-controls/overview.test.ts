import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { overviewFromSnapshot, scheduleCompletion } from "./overview.ts";

describe("project overview snapshot", () => {
  it("rounds schedule completion the same way as the two count queries", () => {
    assert.equal(scheduleCompletion(0, 0), 0);
    assert.equal(scheduleCompletion(3, 1), 33);
    assert.equal(scheduleCompletion(2, 1), 50);
  });

  it("maps numeric strings and rounds the estimate once", () => {
    const overview = overviewFromSnapshot({
      takeoff_items: "4",
      documents: "2",
      schedule_tasks: "3",
      schedule_complete: "1",
      contacts: "5",
      daily_logs: "6",
      generated_docs: "7",
      procurement_total: "8",
      procurement_pending: "1",
      punch_total: "9",
      punch_open: "2",
      permits_total: "3",
      permits_approved: "1",
      rfis_open: "2",
      submittals_open: "4",
      estimate_value: "20.6",
      change_orders_pending: "2",
      change_orders_approved: "1",
      pending_change_order_value: "100.5",
      approved_change_order_value: "40",
    });

    assert.equal(overview.takeoff_items, 4);
    assert.equal(overview.schedule_tasks, 3);
    assert.equal(overview.completion, 33);
    assert.equal(overview.estimate_value, 21);
    assert.equal(overview.pending_change_order_value, 100.5);
    assert.equal(overview.procurement_pending, 1);
    assert.equal(overview.punch_open, 2);
    assert.equal(overview.rfis_open, 2);
    assert.equal(overview.submittals_open, 4);
  });

  it("treats a missing count as zero", () => {
    const overview = overviewFromSnapshot({});
    assert.equal(overview.documents, 0);
    assert.equal(overview.completion, 0);
    assert.equal(overview.estimate_value, 0);
  });
});
