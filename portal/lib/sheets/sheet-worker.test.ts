import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processSheetBatch } from "./sheet-worker.ts";

type RpcCall = { name: string; args: Record<string, unknown> };
type InsertCall = { table: string; row: Record<string, unknown> };

interface FakeDbOptions {
  claim?: { data?: unknown; error?: unknown };
  completeErrorFor?: Record<string, unknown>;
  failThrows?: boolean;
  insertThrows?: boolean;
  refreshThrows?: boolean;
}

function createFakeDb(options: FakeDbOptions = {}) {
  const rpcCalls: RpcCall[] = [];
  const inserts: InsertCall[] = [];

  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "claim_unparsed_sheets") {
        return { data: options.claim?.data ?? null, error: options.claim?.error ?? null };
      }
      if (name === "complete_sheet_processing") {
        const id = String(args.p_id);
        return { error: options.completeErrorFor?.[id] ?? null };
      }
      if (name === "fail_sheet_processing") {
        if (options.failThrows) throw new Error("fail rpc down");
        return { error: null };
      }
      if (name === "refresh_sheet_index_status") {
        if (options.refreshThrows) throw new Error("refresh down");
        return { data: "done", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        if (options.insertThrows) throw new Error("insert down");
        return { error: null };
      },
    }),
  };

  return { db, rpcCalls, inserts };
}

const linkedSheet = {
  id: "sheet-1",
  tenant_id: "tenant-1",
  project_id: "project-1",
  document_id: "doc-1",
  document_page_id: "page-1",
  page_number: 2,
};

describe("processSheetBatch", () => {
  it("returns an empty result when nothing is claimable", async () => {
    const { db, rpcCalls, inserts } = createFakeDb({ claim: { data: null } });

    const result = await processSheetBatch(db, "worker-a");

    assert.deepEqual(result, { claimed: 0, completed: 0, failed: 0, errors: [] });
    assert.deepEqual(rpcCalls, [
      {
        name: "claim_unparsed_sheets",
        args: {
          p_limit: 20,
          p_worker_id: "worker-a",
          p_visibility_timeout_seconds: 120,
        },
      },
    ]);
    assert.deepEqual(inserts, []);
  });

  it("forwards batch size and visibility timeout to the claim", async () => {
    const { db, rpcCalls } = createFakeDb({ claim: { data: [] } });

    await processSheetBatch(db, "worker-b", { batchSize: 7, visibilityTimeoutSeconds: 45 });

    assert.deepEqual(rpcCalls[0]?.args, {
      p_limit: 7,
      p_worker_id: "worker-b",
      p_visibility_timeout_seconds: 45,
    });
  });

  it("throws the claim error and does not complete or refresh", async () => {
    const claimErr = new Error("claim locked");
    const { db, rpcCalls } = createFakeDb({ claim: { error: claimErr } });

    await assert.rejects(processSheetBatch(db, "worker-c"), (err: unknown) => err === claimErr);
    assert.deepEqual(rpcCalls.map((call) => call.name), ["claim_unparsed_sheets"]);
  });

  it("completes a linked sheet and refreshes that document once", async () => {
    const { db, rpcCalls, inserts } = createFakeDb({
      claim: { data: [linkedSheet, { ...linkedSheet, id: "sheet-2", document_page_id: "page-2" }] },
    });

    const result = await processSheetBatch(db, "worker-d");

    assert.equal(result.claimed, 2);
    assert.equal(result.completed, 2);
    assert.equal(result.failed, 0);
    assert.deepEqual(
      rpcCalls.filter((call) => call.name === "complete_sheet_processing").map((call) => call.args.p_id),
      ["sheet-1", "sheet-2"],
    );
    assert.deepEqual(
      rpcCalls.filter((call) => call.name === "refresh_sheet_index_status").map((call) => call.args.p_document_id),
      ["doc-1"],
    );
    assert.equal(inserts.length, 2);
    assert.equal(inserts[0]?.table, "document_processing_events");
    assert.equal(inserts[0]?.row.status, "succeeded");
    assert.equal(inserts[0]?.row.step, "sheet_index");
    assert.equal(inserts[0]?.row.worker, "worker-d");
    assert.equal(inserts[0]?.row.document_page_id, "page-1");
  });

  it("fails a sheet with no page link and still indexes the rest of the batch", async () => {
    const unlinked = { ...linkedSheet, id: "sheet-missing", document_page_id: null };
    const otherDoc = {
      ...linkedSheet,
      id: "sheet-ok",
      document_id: "doc-2",
      document_page_id: "page-9",
    };
    const { db, rpcCalls, inserts } = createFakeDb({
      claim: { data: [unlinked, otherDoc] },
    });

    const result = await processSheetBatch(db, "worker-e");

    assert.equal(result.claimed, 2);
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.id, "sheet-missing");
    assert.match(result.errors[0]?.error ?? "", /document_page_id/);

    const fail = rpcCalls.find((call) => call.name === "fail_sheet_processing");
    assert.equal(fail?.args.p_id, "sheet-missing");
    assert.match(String(fail?.args.p_error), /document_page_id/);

    assert.equal(
      rpcCalls.filter((call) => call.name === "complete_sheet_processing").length,
      1,
    );
    assert.deepEqual(
      rpcCalls.filter((call) => call.name === "refresh_sheet_index_status").map((call) => call.args.p_document_id),
      ["doc-1", "doc-2"],
    );

    const failedEvent = inserts.find((row) => row.row.status === "failed");
    assert.equal(failedEvent?.row.document_page_id, null);
    assert.equal(failedEvent?.row.step, "sheet_index");
    const succeededEvent = inserts.find((row) => row.row.status === "succeeded");
    assert.equal(succeededEvent?.row.document_id, "doc-2");
  });

  it("records a complete failure and truncates stored error text", async () => {
    const longMessage = "e".repeat(2500);
    const { db, rpcCalls, inserts } = createFakeDb({
      claim: { data: [linkedSheet] },
      completeErrorFor: { "sheet-1": new Error(longMessage) },
    });

    const result = await processSheetBatch(db, "worker-f");

    assert.equal(result.completed, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.errors[0]?.error.length, 2500);

    const fail = rpcCalls.find((call) => call.name === "fail_sheet_processing");
    assert.equal(String(fail?.args.p_error).length, 500);
    const failedEvent = inserts.find((row) => row.row.status === "failed");
    assert.equal(String(failedEvent?.row.error_message).length, 2000);
    assert.deepEqual(
      rpcCalls.filter((call) => call.name === "refresh_sheet_index_status").map((call) => call.args.p_document_id),
      ["doc-1"],
    );
  });

  it("still counts success when the event insert fails", async () => {
    const { db } = createFakeDb({
      claim: { data: [linkedSheet] },
      insertThrows: true,
    });

    const result = await processSheetBatch(db, "worker-g");

    assert.equal(result.completed, 1);
    assert.equal(result.failed, 0);
  });

  it("returns the batch when fail and refresh side effects throw", async () => {
    const { db } = createFakeDb({
      claim: { data: [{ ...linkedSheet, document_page_id: null }] },
      failThrows: true,
      refreshThrows: true,
    });

    const result = await processSheetBatch(db, "worker-h");

    assert.equal(result.failed, 1);
    assert.match(result.errors[0]?.error ?? "", /document_page_id/);
  });
});
