import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bufferCenterline } from "./centerline.ts";

describe("centerline buffer", () => {
  it("turns a straight run into length times full width", () => {
    const paved = bufferCenterline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.5);
    assert.ok(Math.abs(paved.area - 10) < 1e-6);
    assert.ok(paved.ring.length >= 4);
  });
});
