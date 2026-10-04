import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quantityForLinkedLine } from "./linked-quantity.ts";

describe("linked estimate quantity", () => {
  it("keeps the measurement until the line is unlinked", () => {
    assert.equal(quantityForLinkedLine(18, 99, "takeoff-1", false), 18);
    assert.equal(quantityForLinkedLine(18, 99, "takeoff-1", true), 99);
    assert.equal(quantityForLinkedLine(18, 99, null, false), 99);
  });
});
