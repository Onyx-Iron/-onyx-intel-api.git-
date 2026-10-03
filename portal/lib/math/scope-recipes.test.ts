import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calcPipeEmbedment } from "./civil-scope.ts";
import { utilityRecipeLines, wallRecipeLines } from "./scope-recipes.ts";

describe("drawn scope recipes", () => {
  it("expands a pipe run into trench materials from the embedment math", () => {
    const embedment = calcPipeEmbedment({
      length_lf: 100,
      diameter_in: 12,
      trench_width_ft: 3,
      avg_depth_ft: 4,
    });
    const lines = utilityRecipeLines({
      name: "Sanitary Sewer",
      system: "Sanitary Sewer",
      diameter_in: 12,
      length_lf: 100,
      embedment,
    });

    const byLabel = Object.fromEntries(lines.map((line) => [line.label, line]));
    assert.equal(byLabel["Sanitary Sewer pipe (12\" dia)"].csi_code, "33-30-00");
    assert.equal(byLabel["Sanitary Sewer pipe (12\" dia)"].quantity, 100);
    assert.equal(byLabel["Sanitary Sewer pipe (12\" dia)"].unit, "LF");
    assert.equal(byLabel["Sanitary Sewer trench excavation"].quantity, embedment.trench_excavation_bcy);
    assert.equal(byLabel["Sanitary Sewer trench bedding"].quantity, embedment.bedding_cy);
    assert.equal(byLabel["Sanitary Sewer trench haunching"].quantity, embedment.haunching_cy);
    assert.equal(byLabel["Sanitary Sewer trench initial backfill"].quantity, embedment.initial_backfill_cy);
    assert.equal(byLabel["Sanitary Sewer trench common backfill"].quantity, embedment.common_backfill_cy);
    assert.equal(byLabel["Sanitary Sewer trench spoils export"].quantity, embedment.spoils_export_bcy);
    assert.ok(lines.every((line) => line.quantity > 0));
  });

  it("expands a drawn wall into concrete, both-face formwork, and rebar", () => {
    const lines = wallRecipeLines({
      name: "Retaining wall",
      length_lf: 100,
      height_ft: 8,
      thickness_in: 8,
      rebar_size: "#4",
      rebar_spacing_inches: 18,
    });
    const concrete = lines.find((line) => line.csi_code === "03-30-00");
    const formwork = lines.find((line) => line.csi_code === "03-11-00");
    const rebar = lines.find((line) => line.csi_code === "03-20-00");
    assert.equal(concrete?.unit, "CY");
    assert.equal(concrete?.quantity, 19.75);
    assert.equal(formwork?.quantity, 1600);
    assert.equal(formwork?.unit, "SF");
    assert.equal(rebar?.unit, "LB");
    assert.ok((rebar?.quantity ?? 0) > 0);
  });

  it("omits rebar when a wall has no bar size", () => {
    const lines = wallRecipeLines({
      length_lf: 40,
      height_ft: 4,
      thickness_in: 6,
    });
    assert.equal(lines.some((line) => line.csi_code === "03-20-00"), false);
    assert.equal(lines.length, 2);
  });
});
