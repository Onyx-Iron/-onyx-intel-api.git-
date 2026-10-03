import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { netArea } from "./net-area.ts";

describe("net area", () => {
  it("subtracts a shaft from a slab", () => {
    const slab = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const shaft = [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }];
    assert.equal(netArea(slab, [shaft]), 96);
  });
});
