import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planPageTakeoffWrite,
  shouldSkipTakeoffForPartialDocument,
} from "../../supabase/functions/_shared/page-takeoff-idempotency.ts";

describe("shouldSkipTakeoffForPartialDocument", () => {
  it("skips a finished partial the estimator has not accepted", () => {
    assert.equal(shouldSkipTakeoffForPartialDocument({
      status: "complete_with_errors",
      meta: { processing_summary: { pages_split_through: 10, pages_total: 10 } },
    }), true);
  });

  it("extracts later pages when the partial stamp is from an unfinished split batch", () => {
    assert.equal(shouldSkipTakeoffForPartialDocument({
      status: "complete_with_errors",
      meta: { processing_summary: { pages_split_through: 75, pages_total: 200 } },
    }), false);
  });

  it("extracts once the estimator accepts the partial plan", () => {
    assert.equal(shouldSkipTakeoffForPartialDocument({
      status: "complete_with_errors",
      meta: { partial_acknowledged: true },
    }), false);
  });

  it("extracts while the parent is still processing", () => {
    assert.equal(shouldSkipTakeoffForPartialDocument({ status: "processing", meta: {} }), false);
  });
});

describe("planPageTakeoffWrite", () => {
  const pageId = "page-2";

  it("inserts when this page has no stored takeoff", () => {
    assert.deepEqual(planPageTakeoffWrite([], pageId), { action: "insert" });
  });

  it("keeps rows already linked to this page and does not insert again", () => {
    assert.deepEqual(
      planPageTakeoffWrite([{ id: "row-1", sheet_id: pageId }], pageId),
      { action: "keep", keptCount: 1, relinkIds: [] },
    );
  });

  it("keeps quantities left behind when split delete nulls sheet_id", () => {
    assert.deepEqual(
      planPageTakeoffWrite([
        { id: "row-1", sheet_id: null },
        { id: "row-1", sheet_id: null },
        { id: "row-2", sheet_id: "old-page" },
      ], pageId),
      { action: "keep", keptCount: 2, relinkIds: ["row-1", "row-2"] },
    );
  });
});
