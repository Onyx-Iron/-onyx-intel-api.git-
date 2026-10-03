import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreCostConfidence } from "./confidence.ts";

describe("scoreCostConfidence", () => {
  it("returns low for empty observations", () => {
    assert.equal(scoreCostConfidence([]).confidence, "low");
  });

  it("returns high for multiple recent agreeing sources", () => {
    const now = Date.now();
    const recent = new Date(now - 10 * 864e5).toISOString();
    const r = scoreCostConfidence([
      { unitCost: 100, observedAt: recent, source: "bls" },
      { unitCost: 102, observedAt: recent, source: "dot_tx" },
      { unitCost: 101, observedAt: recent, source: "tenant_actual" },
    ], now);
    assert.equal(r.confidence, "high");
    assert.equal(r.sourceCount, 3);
  });
});
