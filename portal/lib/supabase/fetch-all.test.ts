import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchAllPages } from "./fetch-all.ts";

describe("fetchAllPages", () => {
  it("concatenates every page, including a full first page", async () => {
    const calls: Array<[number, number]> = [];
    const result = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      if (from === 0) return { data: [1, 2], error: null };
      if (from === 2) return { data: [3], error: null };
      return { data: [], error: null };
    }, 2);
    assert.deepEqual(result.rows, [1, 2, 3]);
    assert.equal(result.error, null);
    assert.deepEqual(calls, [[0, 1], [2, 3]]);
  });

  it("stops on an error and does not request another page", async () => {
    let calls = 0;
    const result = await fetchAllPages<number>(async () => {
      calls += 1;
      if (calls === 1) return { data: [1, 2], error: null };
      return { data: null, error: { message: "statement timeout" } };
    }, 2);
    assert.deepEqual(result.rows, [1, 2]);
    assert.equal(result.error, "statement timeout");
    assert.equal(calls, 2);
  });

  it("treats an empty table as no rows", async () => {
    const result = await fetchAllPages<number>(async () => ({ data: [], error: null }), 2);
    assert.deepEqual(result.rows, []);
    assert.equal(result.error, null);
  });
});
