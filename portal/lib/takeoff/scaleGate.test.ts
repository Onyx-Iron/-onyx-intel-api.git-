import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sheetHasVerifiedScale,
  toolRequiresVerifiedScale,
} from "./scaleGate.ts";

describe("scaleGate", () => {
  it("gates measure tools and leaves pan/calibrate open", () => {
    assert.equal(toolRequiresVerifiedScale("length"), true);
    assert.equal(toolRequiresVerifiedScale("area"), true);
    assert.equal(toolRequiresVerifiedScale("count"), true);
    assert.equal(toolRequiresVerifiedScale("pan"), false);
    assert.equal(toolRequiresVerifiedScale("calibrate"), false);
  });

  it("requires verified status and a finite page-space factor", () => {
    assert.equal(sheetHasVerifiedScale(null), false);
    assert.equal(sheetHasVerifiedScale({ status: "needs_verification", page_space_scale_factor: 0.1 }), false);
    assert.equal(sheetHasVerifiedScale({ status: "verified", page_space_scale_factor: null }), false);
    assert.equal(sheetHasVerifiedScale({ status: "verified", page_space_scale_factor: 0.0125 }), true);
  });
});
