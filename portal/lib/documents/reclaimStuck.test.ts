import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STUCK_PENDING_PAGE_MS,
  STUCK_PROCESSING_MS,
  STUCK_QUEUED_MS,
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
  it("returns 0 when the update fails", async () => {
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
    const count = await reclaimStuckProcessingSheets(db, "tenant-1");
    assert.equal(count, 0);
  });

  it("marks only stale processing sheets for the tenant as error", async () => {
    const calls: string[] = [];
    let updatePayload: Record<string, unknown> | undefined;
    let cutoff = "";
    const olderThanMs = 5 * 60 * 1000;
    const before = Date.now();

    const db = {
      from: (table: string) => {
        calls.push(`from:${table}`);
        return {
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload;
            return {
              eq: (column: string, value: string) => {
                calls.push(`eq:${column}=${value}`);
                return {
                  eq: (column2: string, value2: string) => {
                    calls.push(`eq:${column2}=${value2}`);
                    return {
                      lt: (column3: string, value3: string) => {
                        calls.push(`lt:${column3}`);
                        cutoff = value3;
                        return {
                          select: async (columns: string) => {
                            calls.push(`select:${columns}`);
                            return { data: [{ id: "sheet-a" }, { id: "sheet-b" }], error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    const count = await reclaimStuckProcessingSheets(db, "tenant-9", olderThanMs);
    const after = Date.now();

    assert.equal(count, 2);
    assert.deepEqual(calls, [
      "from:sheets",
      "eq:tenant_id=tenant-9",
      "eq:processing_status=processing",
      "lt:updated_at",
      "select:id",
    ]);
    assert.equal(updatePayload?.processing_status, "error");
    assert.equal(updatePayload?.claimed_at, null);
    assert.equal(updatePayload?.claimed_by, null);
    const updatedAt = Date.parse(String(updatePayload?.updated_at));
    assert.ok(updatedAt >= before && updatedAt <= after);
    const cutoffMs = Date.parse(cutoff);
    assert.ok(cutoffMs >= before - olderThanMs - 50);
    assert.ok(cutoffMs <= after - olderThanMs + 50);
  });

  it("returns 0 when no sheets match", async () => {
    const db = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              lt: () => ({
                select: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    };
    const count = await reclaimStuckProcessingSheets(db, "tenant-1", 1000);
    assert.equal(count, 0);
  });
});
