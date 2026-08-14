import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertCompatibleOpportunityLinks } from "./ownership";

describe("preconstruction opportunity link ownership", () => {
  it("accepts tenant-owned project and estimate links for the same project", () => {
    assert.doesNotThrow(() => assertCompatibleOpportunityLinks({
      linkedProjectId: "project-a",
      projectOwned: true,
      linkedEstimateVersionId: "estimate-a",
      estimateProjectId: "project-a",
    }));
  });

  it("rejects missing or cross-tenant linked records", () => {
    assert.throws(() => assertCompatibleOpportunityLinks({
      linkedProjectId: "project-a",
      projectOwned: false,
      linkedEstimateVersionId: null,
      estimateProjectId: null,
    }), /project/i);

    assert.throws(() => assertCompatibleOpportunityLinks({
      linkedProjectId: null,
      projectOwned: false,
      linkedEstimateVersionId: "estimate-a",
      estimateProjectId: null,
    }), /estimate/i);
  });

  it("rejects an estimate linked to a different project", () => {
    assert.throws(() => assertCompatibleOpportunityLinks({
      linkedProjectId: "project-a",
      projectOwned: true,
      linkedEstimateVersionId: "estimate-b",
      estimateProjectId: "project-b",
    }), /same project/i);
  });
});
