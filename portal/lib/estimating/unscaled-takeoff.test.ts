import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { excludeUnscaledManualTakeoff, loadVerifiedCalibrationPageIds } from "./unscaled-takeoff.ts";

describe("excludeUnscaledManualTakeoff", () => {
  it("holds manual measurements until their sheet has a verified scale", () => {
    const verified = new Set(["page-scaled"]);
    const result = excludeUnscaledManualTakeoff(
      [
        { id: "pixel-wall", source_method: "manual", sheet_id: "page-raw", quantity: 400 },
        { id: "scaled-wall", source_method: "manual", sheet_id: "page-scaled", quantity: 40 },
        { id: "extracted", source_method: "deterministic", sheet_id: "page-raw", quantity: 12 },
        { id: "no-sheet", source_method: "manual", sheet_id: null, quantity: 8 },
      ],
      verified,
    );
    assert.equal(result.held, 2);
    assert.deepEqual(result.items.map((item) => item.id), ["scaled-wall", "extracted"]);
  });
});

describe("loadVerifiedCalibrationPageIds", () => {
  it("keeps verified sheets past the first PostgREST page", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ page_id: `page-${i}` }));
    const second = [{ page_id: "page-1000" }, { page_id: "page-1001" }];
    const calls: Array<[number, number]> = [];
    const loaded = await loadVerifiedCalibrationPageIds(async (from, to) => {
      calls.push([from, to]);
      if (from === 0) return { data: first, error: null };
      if (from === 1000) return { data: second, error: null };
      return { data: [], error: null };
    });
    assert.equal(loaded.error, null);
    assert.equal(loaded.pageIds.length, 1002);
    assert.equal(loaded.pageIds[1000], "page-1000");
    assert.deepEqual(calls, [[0, 999], [1000, 1999]]);
  });

  it("drops a partial page when a later read fails", async () => {
    const loaded = await loadVerifiedCalibrationPageIds(async (from) => {
      if (from === 0) return { data: [{ page_id: "page-0" }], error: null };
      return { data: null, error: { message: "timeout" } };
    }, 1);
    assert.equal(loaded.error, "timeout");
    assert.deepEqual(loaded.pageIds, []);
  });
});
