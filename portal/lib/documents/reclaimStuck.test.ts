import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STUCK_PROCESSING_MS, reclaimStuckProcessingSheets } from "./reclaimStuck.ts";

describe("reclaimStuck constants", () => {
  it("uses a timeout longer than normal ingest but short enough to recover", () => {
    assert.ok(STUCK_PROCESSING_MS >= 5 * 60 * 1000);
    assert.ok(STUCK_PROCESSING_MS <= 30 * 60 * 1000);
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
});
