import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { finalizeDocumentsFromOcr } from "./finalizeDocument.ts";

type FakePage = {
  id?: string;
  document_id: string;
  status: string | null;
  takeoff_status?: string | null;
  page_number?: number;
};
type FakeDoc = {
  id: string;
  status: string;
  page_count?: number | null;
  meta: Record<string, unknown> | null;
};

function makeDb(args: {
  docs: FakeDoc[];
  pages: FakePage[];
  updates: Array<{ id: string; patch: Record<string, unknown> }>;
}) {
  return {
    from(table: string) {
      if (table === "documents") {
        return {
          select() {
            return {
              eq() {
                return {
                  in(_col: string, statuses: string[]) {
                    const filtered = args.docs.filter((d) => statuses.includes(d.status));
                    return Promise.resolve({ data: filtered, error: null });
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(col: string, val: string) {
                if (col === "id") {
                  return {
                    eq() {
                      args.updates.push({ id: val, patch });
                      return Promise.resolve({ error: null });
                    },
                  };
                }
                return this;
              },
            };
          },
        };
      }
      if (table === "document_pages") {
        return {
          select() {
            return {
              eq() {
                return {
                  in(_col: string, ids: string[]) {
                    const filtered = args.pages
                      .filter((p) => ids.includes(p.document_id))
                      .slice()
                      .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
                    let start = 0;
                    let end = filtered.length - 1;
                    const result = {
                      order() { return result; },
                      range(from: number, to: number) {
                        start = from;
                        end = to;
                        return result;
                      },
                      then(
                        onFulfilled: (value: { data: FakePage[]; error: null }) => unknown,
                        onRejected?: (reason: unknown) => unknown,
                      ) {
                        return Promise.resolve({
                          data: filtered.slice(start, end + 1),
                          error: null as null,
                        }).then(onFulfilled, onRejected);
                      },
                    };
                    return result;
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("finalizeDocumentsFromOcr", () => {
  it("finalizes split docs when every page OCR is terminal", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const db = makeDb({
      docs: [{ id: "d1", status: "split", page_count: 2, meta: {} }],
      pages: [
        { document_id: "d1", status: "done" },
        { document_id: "d1", status: "done" },
      ],
      updates,
    });

    const results = await finalizeDocumentsFromOcr(db, "tenant-1");
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "complete");
    assert.equal(updates[0]?.patch.status, "complete");
    assert.equal(updates[0]?.patch.split_status, "done");
  });

  it("marks complete_with_errors when some OCR pages failed", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const db = makeDb({
      docs: [{ id: "d2", status: "split", page_count: 2, meta: null }],
      pages: [
        { document_id: "d2", status: "done" },
        { document_id: "d2", status: "error" },
      ],
      updates,
    });

    const results = await finalizeDocumentsFromOcr(db, "tenant-1");
    assert.equal(results[0]?.status, "complete_with_errors");
  });

  it("marks complete_with_errors when split omitted pages", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const db = makeDb({
      docs: [{
        id: "d4",
        status: "split",
        page_count: 10,
        meta: { processing_summary: { failed_uploads: 2 } },
      }],
      pages: Array.from({ length: 8 }, () => ({
        document_id: "d4",
        status: "done",
      })),
      updates,
    });

    const results = await finalizeDocumentsFromOcr(db, "tenant-1");
    assert.equal(results[0]?.status, "complete_with_errors");
    assert.match(String(updates[0]?.patch.last_error), /missing/i);
  });

  it("does not finalize while pages are still pending", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const db = makeDb({
      docs: [{ id: "d3", status: "split", meta: {} }],
      pages: [
        { document_id: "d3", status: "done" },
        { document_id: "d3", status: "pending" },
      ],
      updates,
    });

    const results = await finalizeDocumentsFromOcr(db, "tenant-1");
    assert.equal(results.length, 0);
    assert.equal(updates.length, 0);
  });

  it("does not finalize while takeoff is still in flight", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const db = makeDb({
      docs: [{ id: "d5", status: "split", page_count: 1, meta: {} }],
      pages: [
        { document_id: "d5", status: "done", takeoff_status: "processing" },
      ],
      updates,
    });

    const results = await finalizeDocumentsFromOcr(db, "tenant-1");
    assert.equal(results.length, 0);
    assert.equal(updates.length, 0);
  });

  it("keeps a plan open when a page past the first 1000 rows is still pending", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const pages: FakePage[] = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i).padStart(6, "0"),
      document_id: "d6",
      status: "done",
      takeoff_status: "done",
      page_number: i + 1,
    }));
    pages.push({
      id: "001000",
      document_id: "d6",
      status: "pending",
      takeoff_status: "pending",
      page_number: 1001,
    });
    const db = makeDb({
      docs: [{ id: "d6", status: "split", page_count: 1001, meta: {} }],
      pages,
      updates,
    });

    const results = await finalizeDocumentsFromOcr(db, "tenant-1");
    assert.equal(results.length, 0);
    assert.equal(updates.length, 0);
  });

  it("finalizes a plan whose pages span more than one 1000-row read", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const pages: FakePage[] = Array.from({ length: 1001 }, (_, i) => ({
      id: String(i).padStart(6, "0"),
      document_id: "d7",
      status: "done",
      takeoff_status: "done",
      page_number: i + 1,
    }));
    const db = makeDb({
      docs: [{ id: "d7", status: "split", page_count: 1001, meta: {} }],
      pages,
      updates,
    });

    const results = await finalizeDocumentsFromOcr(db, "tenant-1");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "complete");
    assert.equal(updates[0]?.patch.status, "complete");
    assert.equal(updates[0]?.patch.last_error, null);
  });
});
