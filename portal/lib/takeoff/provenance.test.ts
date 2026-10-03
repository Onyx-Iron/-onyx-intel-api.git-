import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actorForMethod,
  isVisionMeta,
  needsHumanSeal,
  provenanceForNewItem,
} from "./provenance.ts";

describe("provenance stamps", () => {
  it("classifies actors from source methods", () => {
    assert.equal(actorForMethod("ai_vision"), "agent");
    assert.equal(actorForMethod("manual"), "human");
    assert.equal(actorForMethod("civil_calculator"), "deterministic_parser");
    assert.equal(actorForMethod("dxf"), "deterministic_parser");
  });

  it("vision rows start suggested and need a human seal", () => {
    const stamp = provenanceForNewItem({ sourceMethod: "manual", isVisionSourced: true });
    assert.equal(stamp.origin_actor, "agent");
    assert.equal(stamp.review_status, "suggested");
    assert.equal(stamp.source_method, "ai_vision");
    assert.equal(needsHumanSeal(stamp), true);
  });

  it("manual and civil rows are pre-approved", () => {
    const manual = provenanceForNewItem({ sourceMethod: "manual" });
    assert.equal(manual.review_status, "approved");
    assert.equal(needsHumanSeal(manual), false);

    const civil = provenanceForNewItem({ sourceMethod: "civil_calculator" });
    assert.equal(civil.origin_actor, "deterministic_parser");
    assert.equal(civil.review_status, "approved");
  });

  it("detects vision meta from takeoff tab payloads", () => {
    assert.equal(isVisionMeta({ extraction_method: "ai_vision" }), true);
    assert.equal(isVisionMeta({ is_vision_sourced: true }), true);
    assert.equal(isVisionMeta({ extraction_method: "manual" }), false);
  });

  it("treats rejected and reviewed as still gated", () => {
    assert.equal(needsHumanSeal({ review_status: "rejected", origin_actor: "agent" }), true);
    assert.equal(needsHumanSeal({ review_status: "reviewed", origin_actor: "agent" }), true);
    assert.equal(needsHumanSeal({ review_status: "approved", origin_actor: "agent" }), false);
  });
});
