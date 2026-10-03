import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunkArray, mapPool } from "./concurrency.ts";

describe("concurrency helpers", () => {
  it("chunks arrays", () => {
    assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunkArray([], 3), []);
  });

  it("mapPool preserves order with limited concurrency", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const result = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      return n * 10;
    });
    assert.deepEqual(result, [10, 20, 30, 40, 50]);
    assert.ok(maxInflight <= 2);
  });
});
