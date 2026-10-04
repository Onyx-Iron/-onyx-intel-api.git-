import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_PAGE_BATCH,
  batchCountForPages,
  computePageBatchRange,
  fetchAllPages,
  parseMaintainFlag,
  shouldClearPages,
  shouldMaintainOnTick,
  shouldReadOriginalFromStorage,
} from "../../supabase/functions/_shared/splitBatch.ts";

describe("computePageBatchRange", () => {
  it("returns a single batch when pageCount fits in PAGE_BATCH", () => {
    const r = computePageBatchRange(1, 40, 75);
    assert.equal(r.pageFrom, 1);
    assert.equal(r.pageTo, 40);
    assert.equal(r.pageIndexes.length, 40);
    assert.equal(r.pageIndexes[0], 0);
    assert.equal(r.pageIndexes[39], 39);
    assert.equal(r.hasMore, false);
    assert.equal(r.nextPageFrom, null);
  });

  it("caps the first batch and signals continuation for 500+ pages", () => {
    const r = computePageBatchRange(1, 520, 75);
    assert.equal(r.pageTo, 75);
    assert.equal(r.pageIndexes.length, 75);
    assert.equal(r.hasMore, true);
    assert.equal(r.nextPageFrom, 76);
  });

  it("continues from page_from through the final partial batch", () => {
    const mid = computePageBatchRange(76, 520, 75);
    assert.equal(mid.pageFrom, 76);
    assert.equal(mid.pageTo, 150);
    assert.equal(mid.hasMore, true);
    assert.equal(mid.nextPageFrom, 151);

    const last = computePageBatchRange(451, 520, 75);
    assert.equal(last.pageFrom, 451);
    assert.equal(last.pageTo, 520);
    assert.equal(last.pageIndexes.length, 70);
    assert.equal(last.hasMore, false);
    assert.equal(last.nextPageFrom, null);
  });

  it("chains cover every page exactly once for a 500-page deck", () => {
    const pageCount = 500;
    const seen = new Set<number>();
    let from = 1;
    let batches = 0;
    while (from <= pageCount) {
      const r = computePageBatchRange(from, pageCount, DEFAULT_PAGE_BATCH);
      for (const i of r.pageIndexes) {
        assert.ok(!seen.has(i), `duplicate index ${i}`);
        seen.add(i);
      }
      batches += 1;
      if (!r.hasMore || r.nextPageFrom == null) break;
      from = r.nextPageFrom;
    }
    assert.equal(seen.size, pageCount);
    assert.equal(batches, batchCountForPages(pageCount, DEFAULT_PAGE_BATCH));
    assert.equal(batches, 7); // ceil(500/75)
  });

  it("handles empty / out-of-range inputs", () => {
    assert.deepEqual(computePageBatchRange(1, 0, 75).pageIndexes, []);
    assert.equal(computePageBatchRange(10, 5, 75).pageIndexes.length, 0);
  });
});

describe("shouldClearPages / shouldReadOriginalFromStorage", () => {
  it("clears on first batch by default; keeps on continuation", () => {
    assert.equal(shouldClearPages(1), true);
    assert.equal(shouldClearPages(76), false);
    assert.equal(shouldClearPages(76, true), true);
    assert.equal(shouldClearPages(1, false), false);
  });

  it("reads Drive only on the first non-continuation batch", () => {
    assert.equal(shouldReadOriginalFromStorage(1, true), false);
    assert.equal(shouldReadOriginalFromStorage(76, true), true);
    assert.equal(shouldReadOriginalFromStorage(1, false), true);
  });
});

describe("parseMaintainFlag / shouldMaintainOnTick", () => {
  it("defaults maintain on when project-scoped and param omitted", () => {
    assert.equal(parseMaintainFlag(null, true), true);
    assert.equal(parseMaintainFlag(null, false), false);
    assert.equal(parseMaintainFlag("0", true), false);
    assert.equal(parseMaintainFlag("1", false), true);
    assert.equal(parseMaintainFlag("true", true), true);
  });

  it("maintains on tick 1 and every N thereafter", () => {
    assert.equal(shouldMaintainOnTick(1, 3), true);
    assert.equal(shouldMaintainOnTick(2, 3), false);
    assert.equal(shouldMaintainOnTick(3, 3), true);
    assert.equal(shouldMaintainOnTick(6, 3), true);
    assert.equal(shouldMaintainOnTick(0, 3), false);
  });
});

describe("fetchAllPages", () => {
  it("follows a full page and stops on a short page", async () => {
    const calls: Array<[number, number]> = [];
    const result = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      if (from === 0) return { data: [1, 2], error: null };
      return { data: [3], error: null };
    }, 2);
    assert.equal(result.error, null);
    assert.deepEqual(result.rows, [1, 2, 3]);
    assert.deepEqual(calls, [[0, 1], [2, 3]]);
  });

  it("requests the next page when the first page is exactly full", async () => {
    const calls: number[] = [];
    const result = await fetchAllPages(async (from) => {
      calls.push(from);
      if (from === 0) return { data: ["a", "b"], error: null };
      return { data: [], error: null };
    }, 2);
    assert.equal(result.error, null);
    assert.deepEqual(result.rows, ["a", "b"]);
    assert.deepEqual(calls, [0, 2]);
  });

  it("returns the error and does not read further pages", async () => {
    let calls = 0;
    const result = await fetchAllPages(async () => {
      calls += 1;
      return { data: [1, 2], error: { message: "statement timeout" } };
    }, 2);
    assert.equal(calls, 1);
    assert.equal(result.error, "statement timeout");
    assert.deepEqual(result.rows, []);
  });

  it("rejects a non-positive page size", async () => {
    const result = await fetchAllPages(async () => ({ data: [], error: null }), 0);
    assert.equal(result.error, "pageSize must be a positive integer");
    assert.deepEqual(result.rows, []);
  });
});
