import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processSheetBatch } from "./sheet-worker.ts";

interface SheetClaim {
  id: string;
  tenant_id: string;
  project_id: string;
  document_id: string;
  document_page_id: string | null;
  page_number: number | null;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface InsertCall {
  table: string;
  row: Record<string, unknown>;
}

function createDb(options: {
  sheets?: SheetClaim[];
  claimError?: Error;
  completeErrorIds?: Set<string>;
  rejectSucceededInsert?: boolean;
}) {
  const rpcCalls: RpcCall[] = [];
  const inserts: InsertCall[] = [];

  const db = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "claim_unparsed_sheets") {
        return { data: options.sheets ?? [], error: options.claimError ?? null };
      }
      if (name === "complete_sheet_processing" && options.completeErrorIds?.has(String(args.p_id))) {
        return { data: null, error: new Error(`complete failed ${"x".repeat(600)}`) };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          if (options.rejectSucceededInsert && row.status === "succeeded") {
            return Promise.reject(new Error("event insert failed"));
          }
          return Promise.resolve();
        },
      };
    },
  };

  return { db, rpcCalls, inserts };
}

const sheetA: SheetClaim = {
  id: "sheet-a",
  tenant_id: "tenant-a",
  project_id: "project-a",
  document_id: "doc-1",
  document_page_id: "page-a",
  page_number: 1,
};

const sheetB: SheetClaim = {
  id: "sheet-b",
  tenant_id: "tenant-b",
  project_id: "project-b",
  document_id: "doc-1",
  document_page_id: null,
  page_number: 2,
};

describe("processSheetBatch", () => {
  it("indexes each claimed sheet under that sheet's tenant and refreshes the document once", async () => {
    const sibling: SheetClaim = { ...sheetB, document_page_id: "page-b", document_id: "doc-1" };
    const { db, rpcCalls, inserts } = createDb({ sheets: [sheetA, sibling] });

    const result = await processSheetBatch(db, "worker-1", { batchSize: 5, visibilityTimeoutSeconds: 30 });

    assert.deepEqual(result, { claimed: 2, completed: 2, failed: 0, errors: [] });
    assert.deepEqual(rpcCalls[0], {
      name: "claim_unparsed_sheets",
      args: { p_limit: 5, p_worker_id: "worker-1", p_visibility_timeout_seconds: 30 },
    });
    assert.deepEqual(
      rpcCalls.filter((call) => call.name === "complete_sheet_processing").map((call) => call.args.p_id),
      ["sheet-a", "sheet-b"],
    );
    assert.deepEqual(
      rpcCalls.filter((call) => call.name === "refresh_sheet_index_status").map((call) => call.args.p_document_id),
      ["doc-1"],
    );
    assert.deepEqual(inserts.map((insert) => ({
      tenant_id: insert.row.tenant_id,
      project_id: insert.row.project_id,
      document_id: insert.row.document_id,
      document_page_id: insert.row.document_page_id,
      status: insert.row.status,
      worker: insert.row.worker,
    })), [
      { tenant_id: "tenant-a", project_id: "project-a", document_id: "doc-1", document_page_id: "page-a", status: "succeeded", worker: "worker-1" },
      { tenant_id: "tenant-b", project_id: "project-b", document_id: "doc-1", document_page_id: "page-b", status: "succeeded", worker: "worker-1" },
    ]);
  });

  it("records a missing page and a completion error without stopping the batch", async () => {
    const { db, rpcCalls, inserts } = createDb({
      sheets: [sheetB, sheetA],
      completeErrorIds: new Set(["sheet-a"]),
    });

    const result = await processSheetBatch(db, "worker-2");

    assert.equal(result.claimed, 2);
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 2);
    assert.equal(result.errors[0]?.id, "sheet-b");
    assert.match(result.errors[0]?.error ?? "", /no document_page_id/);
    assert.equal(result.errors[1]?.id, "sheet-a");
    assert.equal(
      rpcCalls.filter((call) => call.name === "complete_sheet_processing").length,
      1,
    );

    const failCall = rpcCalls.find((call) => call.name === "fail_sheet_processing" && call.args.p_id === "sheet-a");
    const failedEvent = inserts.find((insert) => insert.row.status === "failed" && insert.row.document_page_id === "page-a");
    const storedError = failedEvent?.row.error_message;
    assert.equal(failedEvent?.row.tenant_id, "tenant-a");
    assert.equal(typeof failCall?.args.p_error, "string");
    assert.equal(typeof storedError, "string");
    assert.equal((failCall?.args.p_error as string).length, 500);
    assert.ok((storedError as string).length > 500);
    assert.ok((storedError as string).length <= 2000);
    assert.equal((storedError as string).slice(0, 500), failCall?.args.p_error);
  });

  it("still counts a sheet complete when the success event insert fails", async () => {
    const { db, rpcCalls } = createDb({ sheets: [sheetA], rejectSucceededInsert: true });

    const result = await processSheetBatch(db, "worker-3");

    assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0, errors: [] });
    assert.equal(rpcCalls.filter((call) => call.name === "refresh_sheet_index_status").length, 1);
  });

  it("does not refresh documents when the claim fails or nothing is claimed", async () => {
    const empty = createDb({ sheets: [] });
    const emptyResult = await processSheetBatch(empty.db, "worker-4");
    assert.deepEqual(emptyResult, { claimed: 0, completed: 0, failed: 0, errors: [] });
    assert.equal(empty.inserts.length, 0);
    assert.equal(empty.rpcCalls.some((call) => call.name === "refresh_sheet_index_status"), false);

    const broken = createDb({ claimError: new Error("claim locked") });
    await assert.rejects(() => processSheetBatch(broken.db, "worker-5"), /claim locked/);
    assert.equal(broken.inserts.length, 0);
  });
});
