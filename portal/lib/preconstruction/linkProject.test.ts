import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBidStage } from "./stages.ts";

/** Pure helpers for bid ↔ project wiring (link-project / stage suggest). */
export function suggestStageAfterEstimateApprove(current: string): "submitted" | "won" | null {
  if (!isBidStage(current)) return null;
  if (current === "pricing" || current === "takeoff" || current === "pursuing") return "submitted";
  if (current === "submitted") return "won";
  return null;
}

export function canAttachDocuments(opportunity: { tenant_id: string }, tenantId: string): boolean {
  return opportunity.tenant_id === tenantId;
}

describe("bid board link / stage suggest", () => {
  it("suggests submitted when estimate approved from pricing/takeoff", () => {
    assert.equal(suggestStageAfterEstimateApprove("pricing"), "submitted");
    assert.equal(suggestStageAfterEstimateApprove("takeoff"), "submitted");
  });

  it("suggests won when already submitted", () => {
    assert.equal(suggestStageAfterEstimateApprove("submitted"), "won");
  });

  it("does not auto-suggest from won/lost/no_bid", () => {
    assert.equal(suggestStageAfterEstimateApprove("won"), null);
    assert.equal(suggestStageAfterEstimateApprove("lost"), null);
  });

  it("isolates attach-documents by tenant", () => {
    assert.equal(canAttachDocuments({ tenant_id: "t1" }, "t1"), true);
    assert.equal(canAttachDocuments({ tenant_id: "t1" }, "t2"), false);
  });
});
