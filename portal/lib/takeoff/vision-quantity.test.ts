import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visionStoredQuantity } from "./vision-quantity.ts";

describe("vision stored quantity", () => {
  it("keeps a schedule count and drops every other invented quantity", () => {
    assert.equal(visionStoredQuantity("schedule", 12), 12);
    assert.equal(visionStoredQuantity("callout", 40), null);
    assert.equal(visionStoredQuantity("text", 8), null);
  });
});
