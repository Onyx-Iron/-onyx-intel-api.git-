import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STUCK_PENDING_PAGE_MS,
  STUCK_PROCESSING_MS,
  STUCK_QUEUED_MS,
  reclaimStuckProcessingDocuments,
  reclaimStuckProcessingPages,
  reclaimStuckProcessingSheets,
} from "./reclaimStuck.ts";

describe("reclaimStuck constants", () => {
  it("uses a timeout longer than normal ingest but short enough to recover", () => {
    assert.ok(STUCK_PROCESSING_MS >= 5 * 60 * 1000);
    assert.ok(STUCK_PROCESSING_MS <= 30 * 60 * 1000);
  });

  it("allows queued docs longer than processing before reclaim", () => {
    assert.ok(STUCK_QUEUED_MS >= STUCK_PROCESSING_MS);
    assert.ok(STUCK_QUEUED_MS <= 30 * 60 * 1000);
  });

  it("reclaims stale pending pages on a comparable window", () => {
    assert.ok(STUCK_PENDING_PAGE_MS >= STUCK_PROCESSING_MS);
    assert.ok(STUCK_PENDING_PAGE_MS <= 30 * 60 * 1000);
  });
});

describe("reclaimStuckProcessingSheets", () => {
  it("throws when the update fails", async () => {
    const db = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              lt: () => ({
                select: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        }),
      }),
    };
    await assert.rejects(() => reclaimStuckProcessingSheets(db, "tenant-1"), /boom/);
  });
});

describe("reclaimStuck project scope", () => {
  it("applies project_id to document reclaim queries", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    const api = {
      eq(col: string, val: unknown) {
        eqCalls.push([col, val]);
        return api;
      },
      not() { return api; },
      is() { return api; },
      lt() { return api; },
      in() { return api; },
      select() { return Promise.resolve({ data: [], error: null }); },
    };
    Object.assign(chain, api);
    const db = {
      from() {
        return {
          update() { return api; },
        };
      },
    };

    await reclaimStuckProcessingDocuments(db, "tenant-1", STUCK_PROCESSING_MS, "proj-9");
    assert.ok(eqCalls.some(([c, v]) => c === "project_id" && v === "proj-9"));
    assert.ok(eqCalls.some(([c, v]) => c === "tenant_id" && v === "tenant-1"));
  });

  it("scopes page reclaim to project document ids", async () => {
    const pageInCalls: unknown[][] = [];
    const pageApi = {
      eq() { return pageApi; },
      lt() { return pageApi; },
      in(col: string, vals: unknown[]) {
        if (col === "document_id") pageInCalls.push(vals);
        return pageApi;
      },
      select() { return Promise.resolve({ data: [], error: null }); },
    };
    const db = {
      from(table: string) {
        if (table === "documents") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        in() {
                          return Promise.resolve({
                            data: [{ id: "d-a" }, { id: "d-b" }],
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        return {
          update() { return pageApi; },
        };
      },
    };

    await reclaimStuckProcessingPages(db, "tenant-1", STUCK_PROCESSING_MS, undefined, "proj-9");
    assert.ok(pageInCalls.length >= 1);
    assert.deepEqual(pageInCalls[0], ["d-a", "d-b"]);
  });
});

