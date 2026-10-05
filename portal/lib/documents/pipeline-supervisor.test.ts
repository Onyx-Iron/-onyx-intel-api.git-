import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectActionableSupervisorDocs,
  nextSupervisorAction,
  supervisorAlreadyStopped,
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

  it("skips uploads the supervisor already stopped and still reaches a newer one", async () => {
    const stopped = { meta: { processing_summary: { last_supervisor_action: "terminal" } } };
    const queued = { id: "new", meta: { processing_summary: { last_supervisor_action: "kick_split" } } };
    const pages = [
      Array.from({ length: 8 }, () => stopped),
      [queued],
    ];
    const picked = await collectActionableSupervisorDocs(
      async (offset, limit) => pages[offset / limit] ?? [],
      8,
      16,
    );
    assert.equal(supervisorAlreadyStopped(stopped.meta), true);
    assert.equal(supervisorAlreadyStopped({}), false);
    assert.deepEqual(picked, [queued]);
  });

  it("stops on a password-protected file and at the attempt cap", () => {
    assert.equal(nextSupervisorAction({ ...base, last_error: "password required" }).action, "terminal");
    assert.equal(nextSupervisorAction({ ...base, last_error: "corrupt PDF" }).action, "terminal");
    assert.equal(nextSupervisorAction({ ...base, attempts: 5 }).action, "terminal");
  });
});
