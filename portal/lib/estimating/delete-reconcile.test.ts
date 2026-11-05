import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectDeletedMirrorIds, detachedTakeoffEstimateFields, filterDraftEstimateItemIds, planRejectedEstimateUpdates, rejectedTakeoffEstimateFields, sourceRemovedEstimateFields } from "./delete-reconcile.ts";

describe("delete-reconcile", () => {
  it("prefers payload mirror_id and unions history/retained ids", () => {
    assert.deepEqual(
      collectDeletedMirrorIds({
        payloadMirrorId: "m1",
        historyTakeoffItemIds: ["m1", "m2", null],
        retainedMirrorIds: ["m3"],
      }).sort(),
      ["m1", "m2", "m3"],
    );
  });

  it("returns empty when nothing identifies a mirror", () => {
    assert.deepEqual(collectDeletedMirrorIds({}), []);
  });

  it("removes only draft/review estimate lines", () => {
    const ids = filterDraftEstimateItemIds(
      [
        { id: "a", estimate_version_id: "v-draft" },
        { id: "b", estimate_version_id: "v-approved" },
        { id: "c", estimate_version_id: "v-review" },
      ],
      [
        { id: "v-draft", status: "draft" },
        { id: "v-approved", status: "approved" },
        { id: "v-review", status: "review" },
      ],
    );
    assert.deepEqual(ids.sort(), ["a", "c"]);
  });

  it("zeros a removed takeoff's price and does not stack the source-removed note", () => {
    const fields = sourceRemovedEstimateFields("Source: takeoff import");
    assert.equal(fields.notes, "Source removed — Source: takeoff import");
    assert.equal(fields.pricing_status, "unpriced");
    assert.equal(fields.total_price, 0);
    assert.equal(fields.unit_cost, null);
    assert.equal(fields.labor_cost, 0);
    assert.equal(sourceRemovedEstimateFields(fields.notes).notes, fields.notes);
    assert.equal(sourceRemovedEstimateFields("  ").notes, "Source removed");
    const detached = detachedTakeoffEstimateFields("Source: takeoff import");
    assert.equal(detached.total_price, 0);
    assert.equal(detached.source_fingerprint, null);
  });

  it("zeros a rejected takeoff on draft lines and leaves an approved version priced", () => {
    const fields = rejectedTakeoffEstimateFields("AI vision [onyx_takeoff_fingerprint:pipe|10]");
    assert.equal(fields.notes, "Rejected — AI vision");
    assert.equal(fields.notes.includes("onyx_takeoff_fingerprint"), false);
    assert.equal(fields.total_price, 0);
    assert.equal(fields.quantity, 0);
    assert.equal(fields.unit_cost, null);
    assert.equal(fields.source_fingerprint, null);
    assert.equal(rejectedTakeoffEstimateFields(fields.notes).notes, fields.notes);

    const updates = planRejectedEstimateUpdates(
      [
        { id: "draft-line", estimate_version_id: "v-draft", notes: "AI vision" },
        { id: "locked-line", estimate_version_id: "v-approved", notes: "AI vision" },
      ],
      [
        { id: "v-draft", status: "draft" },
        { id: "v-approved", status: "approved" },
      ],
    );
    assert.deepEqual(updates.map((row) => row.id), ["draft-line"]);
    assert.equal(updates[0]?.fields.total_price, 0);
  });
});
