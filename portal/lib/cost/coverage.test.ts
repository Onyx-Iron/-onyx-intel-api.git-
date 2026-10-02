import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { missingPriceCodes } from "./coverage.ts";

describe("takeoff cost coverage", () => {
  it("lists codes that have no price and keeps codes that do", () => {
    const missing = missingPriceCodes(
      ["22-11-16", "26-24-16", "22-11-16", null, ""],
      ["26-24-16"],
    );
    assert.deepEqual(missing, ["22-11-16"]);
  });
});
