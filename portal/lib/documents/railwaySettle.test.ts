import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { settleRailwayExtracts } from "./railwaySettle.ts";
import type { RailwayJobSnapshot } from "./railwayJob.ts";

interface FakeDoc {
  id: string;
  tenant_id: string;
  project_id: string | null;
  status: string;
  processing_started_at: string | null;
  last_error: string | null;
  last_error_step: string | null;
  meta: Record<string, unknown>;
  takeoff_status?: string;
  processed_at?: string | null;
}

interface FakeItem {
  id: string;
  tenant_id: string;
  project_id: string;
  meta: Record<string, unknown>;
  quantity?: number | null;
  review_status?: string;
  source_method?: string;
}

function matches(row: Record<string, unknown>, filters: Array<[string, string, unknown]>): boolean {
  for (const [op, col, val] of filters) {
    if (op === "eq" && row[col] !== val) return false;
    if (op === "in" && !(Array.isArray(val) && val.includes(row[col]))) return false;
    if (op === "contains") {
      const meta = row[col];
      if (!meta || typeof meta !== "object") return false;
      for (const [key, expected] of Object.entries(val as Record<string, unknown>)) {
        if ((meta as Record<string, unknown>)[key] !== expected) return false;
      }
    }
  }
  return true;
}

function createFakeDb(docs: FakeDoc[], items: FakeItem[] = []) {
  const state = { docs, items, inserts: 0 };
  function chain(table: "documents" | "takeoff_items", op: "select" | "update" | "insert", payload?: unknown) {
    const filters: Array<[string, string, unknown]> = [];
    const api = {
      select() { return api; },
      eq(col: string, val: unknown) { filters.push(["eq", col, val]); return api; },
      in(col: string, val: unknown) { filters.push(["in", col, val]); return api; },
      contains(col: string, val: unknown) { filters.push(["contains", col, val]); return api; },
      limit() { return api; },
      then(resolve: (value: { data: unknown; error: null }) => void) {
        if (table === "documents" && op === "select") {
          resolve({ data: state.docs.filter((doc) => matches(doc as unknown as Record<string, unknown>, filters)), error: null });
          return;
        }
        if (table === "documents" && op === "update") {
          for (const doc of state.docs) {
            if (matches(doc as unknown as Record<string, unknown>, filters)) {
              Object.assign(doc, payload);
            }
          }
          resolve({ data: null, error: null });
          return;
        }
        if (table === "takeoff_items" && op === "select") {
          resolve({ data: state.items.filter((item) => matches(item as unknown as Record<string, unknown>, filters)), error: null });
          return;
        }
        if (table === "takeoff_items" && op === "insert") {
          const rows = payload as FakeItem[];
          state.items.push(...rows);
          state.inserts += 1;
          resolve({ data: rows.map((row) => ({ id: row.id })), error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return api;
  }

  return {
    state,
    from(table: "documents" | "takeoff_items") {
      return {
        select() { return chain(table, "select"); },
        update(payload: unknown) { return chain(table, "update", payload); },
        insert(payload: unknown) { return chain(table, "insert", payload); },
      };
    },
  };
}

const NOW = new Date("2026-10-03T12:00:00.000Z");

function processingDoc(overrides: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: "doc-1",
    tenant_id: "tenant-1",
    project_id: "project-1",
    status: "processing",
    processing_started_at: "2026-10-03T11:50:00.000Z",
    last_error: null,
    last_error_step: null,
    meta: {
      processing: "railway_celery",
      railway_job_id: "job-1",
      railway_enqueued_at: "2026-10-03T11:50:00.000Z",
    },
    ...overrides,
  };
}

describe("settleRailwayExtracts", () => {
  it("writes takeoff rows and marks the document complete when the job succeeds", async () => {
    const db = createFakeDb([processingDoc()]);
    const synced: string[] = [];
    const jobs = new Map<string, RailwayJobSnapshot>([
      ["job-1", {
        status: "success",
        ready: true,
        successful: true,
        result: {
          source_type: "dxf",
          rows: [{ description: "12 inch storm", total_qty: 80, uom: "LF", cost_code: "33-40-00" }],
        },
      }],
    ]);

    const result = await settleRailwayExtracts(db, "tenant-1", {
      now: NOW,
      fetchJob: async (jobId) => jobs.get(jobId) ?? null,
      syncProject: async (_tenantId, projectId) => { synced.push(projectId); },
    });

    assert.deepEqual(result, { imported: 1, failed: 0, waiting: 0 });
    assert.equal(db.state.items.length, 1);
    assert.equal(db.state.items[0].quantity, 80);
    assert.equal(db.state.items[0].review_status, "approved");
    assert.equal(db.state.items[0].source_method, "dxf");
    assert.equal(db.state.items[0].meta.railway_job_id, "job-1");
    assert.equal(db.state.docs[0].status, "complete");
    assert.equal(db.state.docs[0].takeoff_status, "done");
    assert.deepEqual(synced, ["project-1"]);
  });

  it("does not insert twice when the job is settled again", async () => {
    const db = createFakeDb([processingDoc()]);
    const job: RailwayJobSnapshot = {
      status: "success",
      result: { source_type: "dxf", rows: [{ description: "pipe", total_qty: 10, uom: "LF", cost_code: "33-40-00" }] },
    };
    const opts = {
      now: NOW,
      fetchJob: async () => job,
      syncProject: async () => {},
    };
    await settleRailwayExtracts(db, "tenant-1", opts);
    db.state.docs[0].status = "processing";
    delete db.state.docs[0].meta.railway_settled_at;
    await settleRailwayExtracts(db, "tenant-1", opts);
    assert.equal(db.state.items.length, 1);
    assert.equal(db.state.inserts, 1);
  });

  it("keeps a live job out of the stuck-processing reclaim window", async () => {
    const db = createFakeDb([processingDoc({
      status: "error",
      last_error_step: "stuck_processing_reclaim",
    })]);
    const result = await settleRailwayExtracts(db, "tenant-1", {
      now: NOW,
      fetchJob: async () => ({ status: "started", ready: false, successful: null }),
      syncProject: async () => { throw new Error("should not sync"); },
    });
    assert.equal(result.waiting, 1);
    assert.equal(db.state.docs[0].status, "processing");
    assert.equal(db.state.docs[0].processing_started_at, NOW.toISOString());
    assert.equal(db.state.docs[0].last_error_step, null);
    assert.equal(db.state.items.length, 0);
  });

  it("records a worker failure instead of leaving the document processing", async () => {
    const db = createFakeDb([processingDoc()]);
    const result = await settleRailwayExtracts(db, "tenant-1", {
      now: NOW,
      fetchJob: async () => ({ status: "failure", error: "unsupported dxf version" }),
      syncProject: async () => { throw new Error("should not sync"); },
    });
    assert.equal(result.failed, 1);
    assert.equal(db.state.docs[0].status, "error");
    assert.equal(db.state.docs[0].last_error, "unsupported dxf version");
    assert.equal(db.state.docs[0].last_error_step, "railway_extract");
    assert.equal(db.state.items.length, 0);
  });
});
