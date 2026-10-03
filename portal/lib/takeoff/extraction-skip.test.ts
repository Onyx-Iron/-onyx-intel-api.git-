import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dropAiVisionRows } from "./extraction-skip.ts";

describe("ai vision rows", () => {
  it("drops a row tagged ai_vision", () => {
    const kept = dropAiVisionRows([
      { extraction_method: "deterministic", quantity: 12 },
      { extraction_method: "ai_vision", quantity: 99 },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].quantity, 12);
  });
});
