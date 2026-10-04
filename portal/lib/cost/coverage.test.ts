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

  it("treats spaced, hyphenated, and compact CSI codes as the same price", () => {
    const missing = missingPriceCodes(
      ["03 30 00", "05-12-00", "26 24 16"],
      ["033000", "05 12 00"],
    );
    assert.deepEqual(missing, ["26 24 16"]);
  });
});
