import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandAssemblyPlacement } from "./assemblies.ts";

describe("expandAssemblyPlacement", () => {
  it("expands components with shared assembly_group", () => {
    const rows = expandAssemblyPlacement({
      assemblyId: "a1",
      assemblyName: "8in Water",
      baseQuantity: 100,
      components: [
        { cost_code: "33-11-00", quantity_factor: 1, unit: "LF", label: "Pipe" },
        { cost_code: "31-23-16", quantity_factor: 0.5, unit: "CY", label: "Bedding" },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].quantity, 100);
    assert.equal(rows[1].quantity, 50);
    assert.equal(rows[1].unit, "EA"); // CY → EA fallback
    assert.equal(rows[0].meta.assembly_group, rows[1].meta.assembly_group);
    assert.equal(rows[0].meta.assembly_id, "a1");
  });
});
