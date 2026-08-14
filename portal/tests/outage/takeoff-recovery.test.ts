import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processOutboxBatch } from "@/lib/estimating/outbox-worker";
import { recoverTakeoffWork } from "@/lib/takeoff/recovery";

describe("takeoff outage and restart behavior", () => {
  it("does not duplicate a completed estimate sync after a worker restart", async () => {
    let available = true;
    let syncCalls = 0;
    const db = {
      rpc: async (name: string) => {
        if (name === "claim_outbox_events") {
          if (!available) return { data: [], error: null };
          available = false;
          return { data: [{
            id: "event-1", tenant_id: "tenant-1", project_id: "project-1",
            manual_takeoff_id: "source-1", event_type: "upsert", attempts: 0,
          }], error: null };
        }
        if (name === "complete_outbox_event") return { data: null, error: null };
        throw new Error(`Unexpected RPC ${name}`);
      },
    };
    const syncFn = async () => { syncCalls += 1; };

    const first = await processOutboxBatch(db, "worker-before-restart", { syncFn });
    const afterRestart = await processOutboxBatch(db, "worker-after-restart", { syncFn });

    assert.equal(first.completed, 1);
    assert.equal(afterRestart.claimed, 0);
    assert.equal(syncCalls, 1);
  });

  it("keeps exhausted work terminal and visible during scheduled recovery", async () => {
    let recoveryCalls = 0;
    const db = {
      rpc: async (name: string) => {
        if (name === "recover_expired_takeoff_units") {
          recoveryCalls += 1;
          return recoveryCalls === 1
            ? { data: [{ state: "failed_terminal" }], error: null }
            : { data: [], error: null };
        }
        if (name === "claim_outbox_events") return { data: [], error: null };
        throw new Error(`Unexpected RPC ${name}`);
      },
    };

    const first = await recoverTakeoffWork(db, "recovery-1");
    const second = await recoverTakeoffWork(db, "recovery-2");

    assert.deepEqual(first, {
      recoveredUnits: 1,
      terminalUnits: 1,
      outbox: { claimed: 0, completed: 0, failed: 0, deadLettered: 0, errors: [] },
    });
    assert.equal(second.recoveredUnits, 0);
  });
});
