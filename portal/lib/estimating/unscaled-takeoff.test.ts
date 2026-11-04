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

  it("holds rows marked manual only on the extraction method", () => {
    const result = excludeUnscaledManualTakeoff(
      [
        {
          id: "meta-manual",
          source_method: "deterministic",
          sheet_id: "page-raw",
          meta: { extraction_method: "manual" },
          quantity: 400,
        },
        {
          id: "meta-scaled",
          source_method: "vision",
          sheet_id: "page-scaled",
          meta: { extraction_method: "manual" },
          quantity: 12,
        },
      ],
      new Set(["page-scaled"]),
    );
    assert.equal(result.held, 1);
    assert.deepEqual(result.items.map((item) => item.id), ["meta-scaled"]);
  });
});
