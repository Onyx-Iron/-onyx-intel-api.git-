import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scheduleTaskStatusForWrite, scheduleTaskStatusLabel } from "./schedule-status.ts";

describe("schedule task status", () => {
  it("stores the screen's not-started value as the pending status the table allows", () => {
    assert.equal(scheduleTaskStatusForWrite("not_started"), "pending");
    assert.equal(scheduleTaskStatusForWrite("pending"), "pending");
    assert.equal(scheduleTaskStatusForWrite("in_progress"), "in_progress");
    assert.equal(scheduleTaskStatusForWrite("complete"), "complete");
    assert.equal(scheduleTaskStatusForWrite("blocked"), "blocked");
  });

  it("rejects a status the schedule_tasks check would refuse", () => {
    assert.equal(scheduleTaskStatusForWrite("done"), null);
    assert.equal(scheduleTaskStatusForWrite(""), null);
  });

  it("labels the stored pending status as not started", () => {
    assert.equal(scheduleTaskStatusLabel("pending"), "not started");
    assert.equal(scheduleTaskStatusLabel("not_started"), "not started");
    assert.equal(scheduleTaskStatusLabel("in_progress"), "in progress");
  });
});
