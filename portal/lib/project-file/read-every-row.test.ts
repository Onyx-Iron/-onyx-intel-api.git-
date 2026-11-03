import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readEveryRow } from "./read-every-row.ts";

describe("readEveryRow", () => {
  it("follows a full page with the next range", async () => {
    const ranges: Array<[number, number]> = [];
    const rows = await readEveryRow(async (from, to) => {
      ranges.push([from, to]);
      const all = Array.from({ length: 1200 }, (_, index) => index);
      return { data: all.slice(from, to + 1), error: null };
    }, 1000);
    assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
    assert.equal(rows.length, 1200);
    assert.equal(rows[0], 0);
    assert.equal(rows[1199], 1199);
  });

  it("throws when a page stays full past the walk cap", async () => {
    await assert.rejects(
      () => readEveryRow(async () => ({ data: [1, 2], error: null }), 2),
      /did not end/,
    );
  });
});
