import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calInputToFeet, parseLenInput, areaVal, volVal } from "./units.ts";

describe("units edge conversion", () => {
  it("converts metric calibration input to internal feet", () => {
    assert.ok(Math.abs(calInputToFeet(3.048, "metric") - 10) < 1e-9);
    assert.equal(calInputToFeet(10, "imperial"), 10);
  });

  it("parses feet-inches and metric meters", () => {
    assert.equal(parseLenInput("12'6\"", "imperial"), 12.5);
    assert.ok(Math.abs(parseLenInput("3.048m", "metric") - 10) < 1e-9);
  });

  it("converts area and volume at the display edge only", () => {
    assert.ok(Math.abs(areaVal(100, "metric") - 9.290304) < 1e-9);
    assert.equal(volVal(27, "imperial"), 1);
  });
});
