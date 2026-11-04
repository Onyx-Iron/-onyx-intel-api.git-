import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  nextSupervisorAction,
  resumeSplitPageFrom,
  SPLIT_BATCH_STALE_MS,
  takeoffKickUsesModel,
} from "./pipeline-supervisor.ts";

const base = {
  status: "queued",
  split_status: "pending",
  pages_on_disk: 0,
  measured: false,
  takeoff_done: false,
  attempts: 0,
  last_error: null,
  last_action: null,
};

describe("document supervisor", () => {
  it("splits, then measures, then runs deterministic takeoff", () => {
    assert.equal(nextSupervisorAction(base).action, "kick_split");
    assert.equal(nextSupervisorAction({ ...base, last_action: "kick_split" }).action, "portal_split");
    assert.equal(nextSupervisorAction({ ...base, pages_on_disk: 2, status: "split", split_status: "done" }).action, "measure");
    assert.equal(nextSupervisorAction({
      ...base,
      pages_on_disk: 2,
      status: "split",
      split_status: "done",
      measured: true,
    }).action, "kick_takeoff");
    assert.equal(takeoffKickUsesModel(), false);
    assert.equal(nextSupervisorAction({
      ...base,
      status: "complete",
      pages_on_disk: 2,
      measured: true,
      takeoff_done: true,
    }).action, "idle");
  });

  it("does not measure a multi-batch split that still has pages left", () => {
    const now = Date.parse("2026-11-04T09:00:00Z");
    const partial = {
      ...base,
      status: "processing",
      split_status: "processing",
      pages_on_disk: 75,
      processing_started_at: new Date(now - 60_000).toISOString(),
    };
    assert.equal(nextSupervisorAction(partial, now).action, "idle");
    assert.equal(nextSupervisorAction(partial, now).reason, "split_batch_in_flight");

    const stalled = {
      ...partial,
      processing_started_at: new Date(now - SPLIT_BATCH_STALE_MS - 1_000).toISOString(),
    };
    assert.equal(nextSupervisorAction(stalled, now).action, "resume_split");

    const reclaimed = { ...partial, status: "error", processing_started_at: null };
    assert.equal(nextSupervisorAction(reclaimed, now).action, "resume_split");
    assert.equal(resumeSplitPageFrom({ next_page_from: 76 }), 76);
    assert.equal(resumeSplitPageFrom({}), null);
  });

  it("stops on a password-protected file and at the attempt cap", () => {
    assert.equal(nextSupervisorAction({ ...base, last_error: "password required" }).action, "terminal");
    assert.equal(nextSupervisorAction({ ...base, last_error: "corrupt PDF" }).action, "terminal");
    assert.equal(nextSupervisorAction({ ...base, attempts: 5 }).action, "terminal");
  });
});
