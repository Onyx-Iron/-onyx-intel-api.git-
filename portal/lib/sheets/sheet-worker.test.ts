import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processSheetBatch } from "./sheet-worker.ts";

type Call =
  | { kind: "rpc"; name: string; args: Record<string, unknown> }
  | { kind: "insert"; table: string; row: Record<string, unknown> };

function sheetDb(options: {
  sheets?: Array<Record<string, unknown>>;
  claimError?: Error;
  completeErrorIds?: string[];
  failRpcError?: boolean;
  insertError?: boolean;
  refreshError?: boolean;
}) {
  const calls: Call[] = [];
  const db = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ kind: "rpc", name, args });
      if (name === "claim_unparsed_sheets") {
        if (options.claimError) return { data: null, error: options.claimError };
        return { data: options.sheets ?? [], error: null };
      }
      if (name === "complete_sheet_processing" && options.completeErrorIds?.includes(String(args.p_id))) {
        return { data: null, error: new Error("complete failed") };
      }
      if (name === "fail_sheet_processing" && options.failRpcError) {
        throw new Error("fail rpc down");
      }
      if (name === "refresh_sheet_index_status" && options.refreshError) {
        throw new Error("refresh down");
      }
      return { data: null, error: null };
    },
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ kind: "insert", table, row });
          if (options.insertError) return Promise.reject(new Error("event insert failed"));
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return db;
}

const readySheet = {
  id: "sheet-1",
  tenant_id: "tenant-1",
  project_id: "project-1",
  document_id: "doc-1",
  document_page_id: "page-1",
  page_number: 1,
};

describe("processSheetBatch", () => {
  it("claims with the default batch and timeout", async () => {
    const db = sheetDb({ sheets: [] });
    const result = await processSheetBatch(db, "worker-a");
    assert.deepEqual(result, { claimed: 0, completed: 0, failed: 0, errors: [] });
    assert.deepEqual(db.calls[0], {
      kind: "rpc",
      name: "claim_unparsed_sheets",
      args: { p_limit: 20, p_worker_id: "worker-a", p_visibility_timeout_seconds: 120 },
    });
  });

  it("passes a custom claim limit through to the locked claim", async () => {
    const db = sheetDb({ sheets: [] });
    await processSheetBatch(db, "worker-a", { batchSize: 5, visibilityTimeoutSeconds: 30 });
    const claim = db.calls[0];
    assert.equal(claim.kind, "rpc");
    if (claim.kind === "rpc") {
      assert.equal(claim.args.p_limit, 5);
      assert.equal(claim.args.p_visibility_timeout_seconds, 30);
    }
  });

  it("throws when the claim itself fails", async () => {
    const db = sheetDb({ claimError: new Error("claim locked") });
    await assert.rejects(() => processSheetBatch(db, "worker-a"), /claim locked/);
  });

  it("indexes a linked page and refreshes each document once", async () => {
    const second = { ...readySheet, id: "sheet-2", document_page_id: "page-2", page_number: 2 };
    const db = sheetDb({ sheets: [readySheet, second] });
    const result = await processSheetBatch(db, "worker-a");

    assert.equal(result.claimed, 2);
    assert.equal(result.completed, 2);
    assert.equal(result.failed, 0);
    const completes = db.calls.filter((call) => call.kind === "rpc" && call.name === "complete_sheet_processing");
    assert.equal(completes.length, 2);
    const refreshes = db.calls.filter((call) => call.kind === "rpc" && call.name === "refresh_sheet_index_status");
    assert.equal(refreshes.length, 1);
    const events = db.calls.filter((call) => call.kind === "insert");
    assert.equal(events.length, 2);
    assert.equal(events[0].kind === "insert" && events[0].row.status, "succeeded");
  });

  it("fails a sheet with no page and still indexes the rest of the claim", async () => {
    const orphan = { ...readySheet, id: "sheet-orphan", document_page_id: null };
    const otherDoc = { ...readySheet, id: "sheet-2", document_id: "doc-2", document_page_id: "page-2" };
    const db = sheetDb({ sheets: [orphan, otherDoc] });
    const result = await processSheetBatch(db, "worker-a");

    assert.equal(result.claimed, 2);
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errors[0].id, "sheet-orphan");
    assert.match(result.errors[0].error, /no document_page_id/);

    const fail = db.calls.find((call) => call.kind === "rpc" && call.name === "fail_sheet_processing");
    assert.ok(fail && fail.kind === "rpc");
    if (fail.kind === "rpc") {
      assert.equal(fail.args.p_id, "sheet-orphan");
      assert.match(String(fail.args.p_error), /no document_page_id/);
    }
    const failedEvent = db.calls.find((call) => call.kind === "insert" && call.row.status === "failed");
    assert.ok(failedEvent && failedEvent.kind === "insert");
    assert.equal(failedEvent.row.document_id, "doc-1");
    const refreshes = db.calls.filter((call) => call.kind === "rpc" && call.name === "refresh_sheet_index_status");
    assert.deepEqual(
      refreshes.map((call) => call.kind === "rpc" && call.args.p_document_id),
      ["doc-1", "doc-2"],
    );
  });

  it("records a complete failure and keeps going when the event insert or fail rpc throws", async () => {
    const db = sheetDb({
      sheets: [{ ...readySheet }],
      completeErrorIds: ["sheet-1"],
      failRpcError: true,
      insertError: true,
    });
    const result = await processSheetBatch(db, "worker-a");
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 1);
    assert.match(result.errors[0].error, /complete failed/);
  });

  it("still counts the sheet indexed when the timeline insert fails", async () => {
    const db = sheetDb({ sheets: [{ ...readySheet }], insertError: true });
    const result = await processSheetBatch(db, "worker-a");
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 0);
  });

  it("still returns the batch when the document status refresh fails", async () => {
    const db = sheetDb({ sheets: [{ ...readySheet }], refreshError: true });
    const result = await processSheetBatch(db, "worker-a");
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 0);
  });
});
