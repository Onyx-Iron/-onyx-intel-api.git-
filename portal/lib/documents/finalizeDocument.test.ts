import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { finalizeDocumentsFromOcr } from "./finalizeDocument.ts";

type FakePage = { document_id: string; status: string | null };
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
                    const data = args.pages.filter((p) => ids.includes(p.document_id));
                    return Promise.resolve({ data, error: null });
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
});
