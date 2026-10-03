import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calibrationErrorPct, checkVerdict } from "./calibration.ts";

describe("checkVerdict", () => {
  it("grades match when displayed error is within 1%", () => {
    assert.equal(checkVerdict(0.4).grade, "match");
    // 1.04 rounds to displayed 1.0 → still match
    assert.equal(checkVerdict(1.04).shown, 1);
    assert.equal(checkVerdict(1.04).grade, "match");
  });

  it("grades close between 1% and 5% displayed", () => {
    assert.equal(checkVerdict(3.2).grade, "close");
    assert.equal(checkVerdict(5).grade, "close");
  });

  it("grades wrong past 5% displayed", () => {
    assert.equal(checkVerdict(6).grade, "wrong");
  });

  it("never grades non-finite as match", () => {
    assert.equal(checkVerdict(NaN).grade, "wrong");
  });
});

describe("calibrationErrorPct", () => {
  it("computes signed percent error", () => {
    assert.ok(Math.abs(calibrationErrorPct(10.2, 10) - 2) < 1e-9);
    assert.equal(calibrationErrorPct(12, 10), 20);
    assert.ok(Number.isNaN(calibrationErrorPct(10, 0)));
  });
});
