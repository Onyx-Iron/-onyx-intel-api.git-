import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coalesceAsync } from "./tenant-cache.ts";

describe("coalesceAsync", () => {
  it("runs the loader once for concurrent callers and then serves the cache", async () => {
    const cache = new Map<string, string>();
    const inflight = new Map<string, Promise<string>>();
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.resolve("tenant-1");
    };

    const [first, second] = await Promise.all([
      coalesceAsync(cache, inflight, "org-a", load),
      coalesceAsync(cache, inflight, "org-a", load),
    ]);
    const third = await coalesceAsync(cache, inflight, "org-a", load);

    assert.equal(first, "tenant-1");
    assert.equal(second, "tenant-1");
    assert.equal(third, "tenant-1");
    assert.equal(loads, 1);
  });

  it("does not cache a failed lookup", async () => {
    const cache = new Map<string, string>();
    const inflight = new Map<string, Promise<string>>();
    let loads = 0;
    const load = () => {
      loads += 1;
      return loads === 1 ? Promise.reject(new Error("down")) : Promise.resolve("tenant-1");
    };

    await assert.rejects(() => coalesceAsync(cache, inflight, "org-a", load));
    const value = await coalesceAsync(cache, inflight, "org-a", load);
    assert.equal(value, "tenant-1");
    assert.equal(loads, 2);
  });
});
