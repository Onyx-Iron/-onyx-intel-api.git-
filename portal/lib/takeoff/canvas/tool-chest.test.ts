import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeFromTool } from "./tool-chest";

describe("placeFromTool", () => {
  it("places a count that already carries its cost code", () => {
    const placed = placeFromTool({
      name: "Door",
      cost_code: "08-11-13",
      unit: "EA",
      tool: "count",
    }, false, null);
    assert.equal(placed.cost_code, "08-11-13");
    assert.equal(placed.takeoff_type, "count");
    assert.equal(placed.unit, "EA");
    assert.equal(placed.calculated_quantity, 1);
  });

  it("keeps a length quantity null until the covering scale is verified", () => {
    const tool = { name: "Curb", cost_code: "32-16-13", unit: "LF", tool: "length" as const };
    assert.equal(placeFromTool(tool, false, 40).calculated_quantity, null);
    assert.equal(placeFromTool(tool, true, 40).calculated_quantity, 40);
  });
});
