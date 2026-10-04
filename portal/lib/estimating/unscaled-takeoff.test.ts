import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { excludeUnscaledManualTakeoff } from "./unscaled-takeoff.ts";

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
