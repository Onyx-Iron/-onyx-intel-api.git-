import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processSheetBatch } from "./sheet-worker.ts";

type ClaimedSheet = {
  id: string;
  tenant_id: string;
  project_id: string;
  document_id: string;
  document_page_id: string | null;
  page_number: number | null;
};

type WorkerCalls = {
  claim: Record<string, unknown> | null;
  complete: string[];
  fail: Array<{ id: string; error: string }>;
  events: Array<Record<string, unknown>>;
  refresh: string[];
};

function makeDb(
  claimed: ClaimedSheet[],
  options: { claimError?: Error; completeErrorFor?: string } = {},
) {
  const calls: WorkerCalls = { claim: null, complete: [], fail: [], events: [], refresh: [] };
  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_unparsed_sheets") {
        calls.claim = args;
        if (options.claimError) return Promise.resolve({ data: null, error: options.claimError });
        return Promise.resolve({ data: claimed, error: null });
      }
      if (name === "complete_sheet_processing") {
        calls.complete.push(String(args.p_id));
        if (options.completeErrorFor === args.p_id) {
          return Promise.resolve({ error: new Error("complete failed") });
        }
        return Promise.resolve({ error: null });
      }
      if (name === "fail_sheet_processing") {
        calls.fail.push({ id: String(args.p_id), error: String(args.p_error) });
        return Promise.resolve({ error: null });
      }
      if (name === "refresh_sheet_index_status") {
        calls.refresh.push(String(args.p_document_id));
        return Promise.resolve({ error: null });
      }
      return Promise.reject(new Error(`unexpected rpc ${name}`));
    },
    from(table: string) {
      if (table !== "document_processing_events") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert(row: Record<string, unknown>) {
          calls.events.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db, calls };
}

const linkedSheet: ClaimedSheet = {
  id: "sheet-1",
  tenant_id: "tenant-1",
  project_id: "project-1",
  document_id: "doc-1",
  document_page_id: "page-1",
  page_number: 2,
};

describe("processSheetBatch", () => {
  it("claims with the default batch and marks a linked sheet indexed", async () => {
    const { db, calls } = makeDb([linkedSheet]);
    const result = await processSheetBatch(db, "worker-1");

    assert.deepEqual(calls.claim, {
      p_limit: 20,
      p_worker_id: "worker-1",
      p_visibility_timeout_seconds: 120,
    });
    assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0, errors: [] });
    assert.deepEqual(calls.complete, ["sheet-1"]);
    assert.deepEqual(calls.refresh, ["doc-1"]);
    assert.equal(calls.events[0]?.step, "sheet_index");
    assert.equal(calls.events[0]?.status, "succeeded");
    assert.equal(calls.events[0]?.document_page_id, "page-1");
  });

  it("fails a sheet that has no page and still refreshes that document once", async () => {
    const { db, calls } = makeDb([
      { ...linkedSheet, id: "sheet-missing", document_page_id: null },
      { ...linkedSheet, id: "sheet-2", document_id: "doc-1" },
    ], { completeErrorFor: "sheet-2" });

    const result = await processSheetBatch(db, "worker-1", {
      batchSize: 5,
      visibilityTimeoutSeconds: 30,
    });

    assert.equal(calls.claim?.p_limit, 5);
    assert.equal(calls.claim?.p_visibility_timeout_seconds, 30);
    assert.equal(result.claimed, 2);
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 2);
    assert.deepEqual(result.errors.map((error) => error.id), ["sheet-missing", "sheet-2"]);
    assert.match(result.errors[0]?.error ?? "", /no document_page_id/);
    assert.equal(result.errors[1]?.error, "complete failed");
    assert.deepEqual(calls.fail.map((row) => row.id), ["sheet-missing", "sheet-2"]);
    assert.deepEqual(calls.refresh, ["doc-1"]);
    assert.deepEqual(calls.events.map((event) => event.status), ["failed", "failed"]);
  });

  it("throws when the claim itself fails and writes nothing", async () => {
    const { db, calls } = makeDb([], { claimError: new Error("claim locked") });
    await assert.rejects(() => processSheetBatch(db, "worker-1"), /claim locked/);
    assert.deepEqual(calls.complete, []);
    assert.deepEqual(calls.refresh, []);
  });
});
