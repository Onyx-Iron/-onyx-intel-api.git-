import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STUCK_PENDING_PAGE_MS,
  STUCK_PROCESSING_MS,
  STUCK_QUEUED_MS,
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

describe("reclaimStuckProcessingPages", () => {
  it("marks stale takeoff pending as error so a missed worker can be retried", async () => {
    const updates: Array<{ patch: Record<string, unknown>; filters: string[] }> = [];

    function chain(patch: Record<string, unknown>) {
      const filters: string[] = [];
      const api = {
        eq(column: string, value: unknown) {
          filters.push(`${column}=${String(value)}`);
          return api;
        },
        lt(column: string, _value: unknown) {
          filters.push(`${column}<cutoff`);
          return api;
        },
        select: async () => {
          updates.push({ patch, filters });
          return { data: [], error: null };
        },
      };
      return api;
    }

    const db = {
      from(table: string) {
        assert.equal(table, "document_pages");
        return {
          update(patch: Record<string, unknown>) {
            return chain(patch);
          },
        };
      },
    };

    await reclaimStuckProcessingPages(db, "tenant-1", undefined, "doc-1");

    const takeoffPending = updates.find((u) => u.filters.includes("takeoff_status=pending"));
    assert.ok(takeoffPending, "expected a stale takeoff pending reclaim");
    assert.equal(takeoffPending?.patch.takeoff_status, "error");
    assert.match(String(takeoffPending?.patch.takeoff_error), /never claimed/);
    assert.ok(takeoffPending?.filters.includes("tenant_id=tenant-1"));
    assert.ok(takeoffPending?.filters.includes("document_id=doc-1"));
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
