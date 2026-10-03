import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evalFormula,
  expandRecipeComponents,
  inferRecipeKey,
} from "./assembly-recipes.ts";
import { scanOmissions } from "../agents/bid-omission-scanner.ts";

describe("assembly recipe formulas", () => {
  it("evaluates qty-driven pipe bedding", () => {
    assert.equal(evalFormula("qty * 0.05", { qty: 100 }), 5);
  });

  it("supports max()", () => {
    assert.equal(evalFormula("max(1, qty / 100)", { qty: 50 }), 1);
    assert.equal(evalFormula("max(1, qty / 100)", { qty: 250 }), 2.5);
  });

  it("expands utility pipe recipe components", () => {
    const lines = expandRecipeComponents(
      [
        {
          item_type: "excavation",
          formula_expression: "qty * 0.15",
          cost_code_ref: "31-23-00",
          description: "Trench excavation",
          unit: "CY",
          labor_factor: 12,
          material_factor: 0,
          sort_order: 10,
        },
        {
          item_type: "pipe",
          formula_expression: "qty",
          cost_code_ref: "33-30-00",
          description: "Pipe material",
          unit: "LF",
          labor_factor: 8,
          material_factor: 22,
          sort_order: 20,
        },
      ],
      { qty: 100 },
      "asm-1",
    );
    assert.equal(lines.length, 2);
    assert.equal(lines[0].quantity, 15);
    assert.equal(lines[1].quantity, 100);
    assert.equal(lines[1].assembly_id, "asm-1");
  });

  it("infers recipe keys from cost codes", () => {
    assert.equal(
      inferRecipeKey({ cost_code: "33-30-00", description: "8in sewer", unit: "LF" }),
      "utility_pipe_lf",
    );
    assert.equal(
      inferRecipeKey({ cost_code: "03-30-00", description: "concrete wall", unit: "LF" }),
      "concrete_wall_lf",
    );
  });
});

describe("bid omission scanner", () => {
  it("flags concrete without rebar / vapor barrier", () => {
    const flags = scanOmissions([
      {
        description: "6 inch concrete slab on grade",
        cost_code: "03-30-00",
        quantity: 5000,
        unit: "SF",
        sheet_ref: "Sheet C-3",
      },
    ]);
    assert.ok(flags.length >= 1);
    const missing = flags[0].missing.join(" ");
    assert.match(missing, /rebar/i);
    assert.match(flags[0].rfi_subject, /Missing scope/i);
    assert.match(flags[0].rfi_body, /vapor barrier|rebar/i);
  });

  it("does not flag when companions present", () => {
    const flags = scanOmissions([
      { description: "concrete slab", cost_code: "03-30-00", quantity: 1, unit: "CY" },
      { description: "rebar #4 mats", cost_code: "03-20-00", quantity: 1, unit: "LB" },
      { description: "underslab vapor barrier", cost_code: "07-26-00", quantity: 1, unit: "SF" },
      { description: "wall formwork", cost_code: "03-11-00", quantity: 1, unit: "SF" },
    ]);
    assert.equal(flags.length, 0);
  });
});
