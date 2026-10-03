import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { insertedIdsFromSync, rollbackOutboxWrites, syncWriteFailure } from "./outbox-rollback.ts";
import { processOutboxBatch } from "./outbox-worker.ts";

describe("sync write failure", () => {
  it("treats a reported write error as a retry, and keeps any ids that did land", () => {
    const failure = syncWriteFailure({ writeError: "insert failed", insertedIds: ["a", ""] });
    assert.deepEqual(failure, { writeError: "insert failed", insertedIds: ["a"] });
    assert.equal(syncWriteFailure({ imported: 1 }), null);
    assert.deepEqual(insertedIdsFromSync({ insertedIds: ["row-1"] }), ["row-1"]);
  });
});

describe("outbox rollback", () => {
  it("removes rows this attempt inserted and puts back rows it deleted", async () => {
    const calls: string[] = [];
    const db = {
      from(table: string) {
        return {
          delete() {
            return { in(_column: string, ids: string[]) { calls.push(`delete ${table} ${ids.join(",")}`); return Promise.resolve({ error: null }); } };
          },
          insert(rows: Array<{ id: string }>) {
            calls.push(`insert ${table} ${rows.map((row) => row.id).join(",")}`);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    await rollbackOutboxWrites(db, {
      insertedIds: ["new-1"],
      restoredRows: [{ id: "old-1" }],
    });
    assert.deepEqual(calls, ["delete estimate_items new-1", "insert estimate_items old-1"]);
  });

  it("fails the queue event and rolls the insert back when the sync write fails", async () => {
    const calls: string[] = [];
    const db = {
      rpc(name: string) {
        calls.push(name);
        if (name === "claim_outbox_events") {
          return Promise.resolve({
            data: [{ id: "evt-1", tenant_id: "t", project_id: "p", manual_takeoff_id: "m", event_type: "upsert", attempts: 0 }],
            error: null,
          });
        }
        return Promise.resolve({ error: null });
      },
      from() {
        return {
          delete() {
            return { in(_column: string, ids: string[]) { calls.push(`rollback ${ids.join(",")}`); return Promise.resolve({ error: null }); } };
          },
        };
      },
    };

    const result = await processOutboxBatch(db, "worker-1", {
      syncFn: async () => ({ writeError: "insert failed", insertedIds: ["new-1"] }),
    });

    assert.equal(result.completed, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.errors[0]?.error, "insert failed");
    assert.ok(calls.includes("rollback new-1"));
    assert.ok(calls.includes("fail_outbox_event"));
    assert.equal(calls.includes("complete_outbox_event"), false);
  });

  it("rolls the insert back when the event cannot be marked complete", async () => {
    const calls: string[] = [];
    const db = {
      rpc(name: string) {
        calls.push(name);
        if (name === "claim_outbox_events") {
          return Promise.resolve({
            data: [{ id: "evt-1", tenant_id: "t", project_id: "p", manual_takeoff_id: "m", event_type: "upsert", attempts: 1 }],
            error: null,
          });
        }
        if (name === "complete_outbox_event") {
          return Promise.resolve({ error: { message: "complete failed" } });
        }
        return Promise.resolve({ error: null });
      },
      from() {
        return {
          delete() {
            return { in(_column: string, ids: string[]) { calls.push(`rollback ${ids.join(",")}`); return Promise.resolve({ error: null }); } };
          },
        };
      },
    };

    const result = await processOutboxBatch(db, "worker-1", {
      syncFn: async () => ({ imported: 1, insertedIds: ["new-1"] }),
    });

    assert.equal(result.completed, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.errors[0]?.error, "complete failed");
    assert.ok(calls.includes("rollback new-1"));
    assert.ok(calls.includes("fail_outbox_event"));
  });

  it("releases the claim when fail_outbox_event is unavailable", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      rpc(name: string) {
        if (name === "claim_outbox_events") {
          return Promise.resolve({
            data: [{ id: "evt-1", tenant_id: "t", project_id: "p", manual_takeoff_id: "m", event_type: "upsert", attempts: 0 }],
            error: null,
          });
        }
        if (name === "fail_outbox_event") return Promise.resolve({ error: { message: "rpc down" } });
        return Promise.resolve({ error: null });
      },
      from() {
        return {
          delete() {
            return { in() { return Promise.resolve({ error: null }); } };
          },
          update(row: Record<string, unknown>) {
            updates.push(row);
            return {
              eq() { return Promise.resolve({ error: null }); },
            };
          },
        };
      },
    };

    const result = await processOutboxBatch(db, "worker-1", {
      syncFn: async () => ({ writeError: "insert failed", insertedIds: [] }),
    });

    assert.equal(result.failed, 1);
    assert.equal(updates[0]?.status, "pending");
    assert.equal(updates[0]?.claimed_by, null);
    assert.equal(typeof updates[0]?.next_attempt_at, "string");
  });

  it("completes the event when the sync write succeeds", async () => {
    const calls: string[] = [];
    const db = {
      rpc(name: string) {
        calls.push(name);
        if (name === "claim_outbox_events") {
          return Promise.resolve({
            data: [{ id: "evt-1", tenant_id: "t", project_id: "p", manual_takeoff_id: "m", event_type: "upsert", attempts: 0 }],
            error: null,
          });
        }
        return Promise.resolve({ error: null });
      },
      from() {
        return {
          delete() {
            return { in(_column: string, ids: string[]) { calls.push(`rollback ${ids.join(",")}`); return Promise.resolve({ error: null }); } };
          },
        };
      },
    };

    const result = await processOutboxBatch(db, "worker-1", {
      syncFn: async () => ({ imported: 1, insertedIds: ["new-1"] }),
    });

    assert.equal(result.completed, 1);
    assert.equal(result.failed, 0);
    assert.ok(calls.includes("complete_outbox_event"));
    assert.equal(calls.some((call) => call.startsWith("rollback")), false);
    assert.equal(calls.includes("fail_outbox_event"), false);
  });

  it("retries a delete when the history read fails and does not remove estimate rows", async () => {
    const calls: string[] = [];
    const db = {
      rpc(name: string) {
        calls.push(name);
        if (name === "claim_outbox_events") {
          return Promise.resolve({
            data: [{ id: "evt-2", tenant_id: "t", project_id: "p", manual_takeoff_id: "m", event_type: "delete", attempts: 0 }],
            error: null,
          });
        }
        return Promise.resolve({ error: null });
      },
      from() {
        const query = {
          select() { return query; },
          eq() { return query; },
          filter() { return Promise.resolve({ data: null, error: { message: "history down" } }); },
          delete() {
            return { in() { calls.push("deleted"); return Promise.resolve({ error: null }); } };
          },
        };
        return query;
      },
    };

    const result = await processOutboxBatch(db, "worker-1");
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.errors[0]?.error, "history down");
    assert.equal(calls.includes("deleted"), false);
    assert.equal(calls.includes("complete_outbox_event"), false);
    assert.ok(calls.includes("fail_outbox_event"));
  });

  it("returns a failure result when the claim itself fails", async () => {
    const db = {
      rpc() {
        return Promise.resolve({ data: null, error: { message: "claim down" } });
      },
    };
    const result = await processOutboxBatch(db, "worker-1", { syncFn: async () => ({}) });
    assert.equal(result.claimed, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.errors[0]?.error, "claim down");
  });
});
