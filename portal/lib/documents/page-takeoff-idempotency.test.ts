import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planPageTakeoffWrite } from "../../supabase/functions/_shared/page-takeoff-idempotency.ts";

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
