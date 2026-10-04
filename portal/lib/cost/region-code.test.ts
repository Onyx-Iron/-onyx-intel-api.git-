import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRegionToken, regionCodeAliases } from "./region-code.ts";

describe("region codes", () => {
  it("treats St Louis and St. Louis as the same region", () => {
    assert.equal(normalizeRegionToken("St Louis"), "St. Louis");
    assert.equal(normalizeRegionToken("st. louis"), "St. Louis");
    const aliases = regionCodeAliases("St Louis");
    assert.ok(aliases.includes("St. Louis"));
    assert.equal(normalizeRegionToken("mo"), "MO");
  });
});
