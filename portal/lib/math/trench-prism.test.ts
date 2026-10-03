import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { trenchPrism } from "./civil-scope.ts";

describe("trench prism", () => {
  it("splits excavation into bedding and backfill", () => {
    const prism = trenchPrism({ length_lf: 27, width_ft: 2, depth_ft: 4, bedding_ft: 0.5 });
    assert.equal(prism.excavation_cy, 8);
    assert.equal(prism.bedding_cy, 1);
    assert.equal(prism.backfill_cy, 7);
  });
});