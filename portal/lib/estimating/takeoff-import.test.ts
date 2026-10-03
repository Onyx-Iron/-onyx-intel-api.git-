import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildEstimateImportRows,
  prepareTakeoffRowsForSave,
  scaledDirectCosts,
  takeoffFingerprint,
} from "./takeoff-import.ts";

describe("takeoff to estimate import quality", () => {
  it("creates stable fingerprints for the same sourced takeoff row", () => {
    const a = takeoffFingerprint({
      id: "takeoff-1",
      label: "  4 inch sanitary pipe ",
      csi_code: "22-11-00",
      quantity: 125,
      unit: "lf",
      meta: {
        drawing_ref: "P2.1",
        location_tag: "Building A",
      },
    });

    const b = takeoffFingerprint({
      id: "takeoff-1",
      label: "4 INCH SANITARY PIPE",
      csi_code: "22-11-00",
      quantity: 125.0,
      unit: "LF",
      meta: {
        drawing_ref: " P2.1 ",
        location_tag: " building a ",
      },
    });

    assert.equal(a, b);
    assert.equal(a, "4 inch sanitary pipe|22-11-00|125|lf|p2.1|building a");
  });

  it("imports only missing takeoff rows and preserves audit evidence", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "takeoff-1",
          label: "4 inch sanitary pipe",
          csi_code: "22-11-00",
          quantity: 125,
          unit: "LF",
          meta: {
            trade: "Plumbing",
            quantity_basis: "Measured polyline on P2.1",
            drawing_ref: "P2.1",
            location_tag: "Building A",
          },
        },
        {
          id: "takeoff-2",
          label: "Panelboard schedule",
          csi_code: "26-24-00",
          quantity: 2,
          unit: "EA",
          meta: {
            trade: "Electrical",
            quantity_basis: "Counted panel schedule rows",
            drawing_ref: "E6.0",
          },
        },
      ],
      existingEstimateItems: [
        {
          source_takeoff_id: "takeoff-2",
          notes: null,
        },
      ],
      costCatalog: [
        {
          csi_code: "22-11-00",
          uom: "LF",
          unit_cost: 42.5,
        },
      ],
      projectId: "project-1",
    });

    assert.equal(result.skipped, 1);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      project_id: "project-1",
      description: "4 inch sanitary pipe",
      csi_code: "22-11-00",
      trade: "Plumbing",
      item_type: "material",
      quantity: 125,
      uom: "LF",
      unit_cost: 42.5,
      source_takeoff_id: "takeoff-1",
      source_fingerprint: "4 inch sanitary pipe|22-11-00|125|lf|p2.1|building a",
      quantity_basis: "Measured polyline on P2.1",
      drawing_ref: "P2.1",
      location_tag: "Building A",
      pricing_status: "priced",
      notes: "Source: P2.1 | Location: Building A | Basis: Measured polyline on P2.1",
    });
  });

  it("deduplicates repeated takeoff saves by source evidence before they reach estimating", () => {
    const result = prepareTakeoffRowsForSave(
      [
        {
          label: "4 INCH SANITARY PIPE",
          csi_code: "22-11-00",
          quantity: 125,
          unit: "lf",
          type: "line",
          page: 2,
          meta: {
            drawing_ref: " P2.1 ",
            location_tag: " building a ",
          },
        },
        {
          label: "Panelboard LP-1",
          csi_code: "26-24-16",
          quantity: 1,
          unit: "EA",
          type: "count",
          page: 6,
          meta: {
            drawing_ref: "E6.0",
          },
        },
        {
          label: "panelboard lp-1",
          csi_code: "26-24-16",
          quantity: 1,
          unit: "ea",
          type: "count",
          page: 6,
          meta: {
            drawing_ref: " E6.0 ",
          },
        },
      ],
      [
        {
          id: "existing-row",
          label: "4 inch sanitary pipe",
          csi_code: "22-11-00",
          quantity: 125,
          unit: "LF",
          meta: {
            drawing_ref: "P2.1",
            location_tag: "Building A",
          },
        },
      ],
    );

    assert.equal(result.skipped, 2);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].label, "Panelboard LP-1");
    assert.deepEqual(result.rows[0].meta, {
      drawing_ref: "E6.0",
      source_fingerprint: "panelboard lp-1|26-24-16|1|ea|e6.0|",
    });
  });

  it("skips duplicate estimate imports even when repeated takeoff rows have new ids", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "new-takeoff-id",
          label: "4 inch sanitary pipe",
          csi_code: "22-11-00",
          quantity: 125,
          unit: "LF",
          meta: {
            drawing_ref: "P2.1",
            location_tag: "Building A",
          },
        },
      ],
      existingEstimateItems: [
        {
          source_takeoff_id: "old-takeoff-id",
          source_fingerprint: "4 inch sanitary pipe|22-11-00|125|lf|p2.1|building a",
        },
      ],
      costCatalog: [],
      projectId: "project-1",
    });

    assert.equal(result.skipped, 1);
    assert.equal(result.rows.length, 0);
  });

  it("keeps an unapproved AI vision quantity out of the estimate", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "ai-takeoff-1",
          label: "Type A luminaires",
          csi_code: "26-51-00",
          quantity: 14,
          unit: "EA",
          meta: {
            trade: "Lighting",
            quantity_basis: "AI vision counted 14 type-A luminaires on E-201",
            drawing_ref: "E-201",
            extraction_method: "ai_vision",
          },
        },
      ],
      existingEstimateItems: [],
      costCatalog: [
        { csi_code: "26-51-00", uom: "EA", unit_cost: 325 },
      ],
      projectId: "project-1",
    });

    assert.equal(result.rows.length, 0);
    assert.equal(result.blockedByReview, 1);
  });

  it("excludes suggested AI takeoff items from the estimate entirely", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "ai-takeoff-suggested",
          label: "Unreviewed AI quantity",
          csi_code: "26-51-00",
          quantity: 99,
          unit: "EA",
          review_status: "suggested",
          meta: { extraction_method: "ai_vision" },
        },
      ],
      existingEstimateItems: [],
      costCatalog: [{ csi_code: "26-51-00", uom: "EA", unit_cost: 325 }],
      projectId: "project-1",
    });

    assert.equal(result.rows.length, 0);
    assert.equal(result.blockedByReview, 1);
    assert.equal(result.skipped, 0);
  });

  it("excludes reviewed-but-not-yet-approved AI takeoff items from the estimate", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "ai-takeoff-reviewed",
          label: "Reviewed but undecided AI quantity",
          csi_code: "26-51-00",
          quantity: 99,
          unit: "EA",
          review_status: "reviewed",
          meta: { extraction_method: "ai_vision" },
        },
      ],
      existingEstimateItems: [],
      costCatalog: [{ csi_code: "26-51-00", uom: "EA", unit_cost: 325 }],
      projectId: "project-1",
    });

    assert.equal(result.rows.length, 0);
    assert.equal(result.blockedByReview, 1);
  });

  it("excludes rejected takeoff items from the estimate permanently, even with a valid price", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "ai-takeoff-rejected",
          label: "Rejected AI quantity",
          csi_code: "26-51-00",
          quantity: 5,
          unit: "EA",
          review_status: "rejected",
          meta: { extraction_method: "ai_vision" },
        },
      ],
      existingEstimateItems: [],
      costCatalog: [{ csi_code: "26-51-00", uom: "EA", unit_cost: 325 }],
      projectId: "project-1",
    });

    assert.equal(result.rows.length, 0);
    assert.equal(result.blockedByReview, 1);
  });

  it("allows an approved AI takeoff item to flow into the estimate normally", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "ai-takeoff-approved",
          label: "Approved AI quantity",
          csi_code: "26-51-00",
          quantity: 14,
          unit: "EA",
          review_status: "approved",
          meta: { extraction_method: "ai_vision" },
        },
      ],
      existingEstimateItems: [],
      costCatalog: [{ csi_code: "26-51-00", uom: "EA", unit_cost: 325 }],
      projectId: "project-1",
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.blockedByReview, 0);
    assert.equal(result.rows[0].unit_cost, 325);
  });

  it("treats a missing review_status as approved (backward compatibility with pre-migration rows)", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "legacy-takeoff",
          label: "Pre-existing manual item",
          csi_code: "03-30-00",
          quantity: 10,
          unit: "CY",
          meta: {},
        },
      ],
      existingEstimateItems: [],
      costCatalog: [{ csi_code: "03-30-00", uom: "CY", unit_cost: 850 }],
      projectId: "project-1",
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.blockedByReview, 0);
  });

  it("updates the draft line when the takeoff quantity changes and leaves other versions alone", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "takeoff-1",
          label: "4 inch sanitary pipe",
          csi_code: "22-11-00",
          quantity: 140,
          unit: "LF",
          meta: { drawing_ref: "P2.1", location_tag: "Building A" },
        },
      ],
      existingEstimateItems: [
        {
          id: "estimate-approved",
          estimate_version_id: "version-approved",
          source_takeoff_id: "takeoff-1",
          source_fingerprint: "4 inch sanitary pipe|22-11-00|125|lf|p2.1|building a",
          quantity: 125,
          unit_cost: 40,
          labor_cost: 1000,
          material_cost: 4000,
          equipment_cost: 0,
        },
        {
          id: "estimate-draft",
          estimate_version_id: "version-draft",
          source_takeoff_id: "takeoff-1",
          source_fingerprint: "4 inch sanitary pipe|22-11-00|125|lf|p2.1|building a",
          quantity: 125,
          unit_cost: 40,
          labor_cost: 1000,
          material_cost: 4000,
          equipment_cost: 0,
        },
      ],
      costCatalog: [{ csi_code: "22-11-00", uom: "LF", unit_cost: 99 }],
      projectId: "project-1",
      targetVersionId: "version-draft",
    });

    assert.equal(result.rows.length, 0);
    assert.equal(result.updates.length, 1);
    assert.equal(result.updates[0].estimateItemId, "estimate-draft");
    assert.equal(result.updates[0].row.quantity, 140);
    assert.deepEqual(scaledDirectCosts(result.updates[0].existing, 140), {
      unitCost: 40,
      laborCost: 1120,
      materialCost: 4480,
      equipmentCost: 0,
    });
  });

  it("inserts a draft line when quantity changed and the draft has no copy of an approved line", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "takeoff-1",
          label: "4 inch sanitary pipe",
          csi_code: "22-11-00",
          quantity: 140,
          unit: "LF",
        },
      ],
      existingEstimateItems: [
        {
          id: "estimate-approved",
          estimate_version_id: "version-approved",
          source_takeoff_id: "takeoff-1",
          source_fingerprint: "4 inch sanitary pipe|22-11-00|125|lf||",
          quantity: 125,
        },
      ],
      costCatalog: [],
      projectId: "project-1",
      targetVersionId: "version-draft",
    });

    assert.equal(result.updates.length, 0);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].quantity, 140);
    assert.equal(result.rows[0].source_takeoff_id, "takeoff-1");
  });

  it("does not rewrite an approved line when no draft version is targeted", () => {
    const result = buildEstimateImportRows({
      takeoffItems: [
        {
          id: "takeoff-1",
          label: "4 inch sanitary pipe",
          csi_code: "22-11-00",
          quantity: 140,
          unit: "LF",
        },
      ],
      existingEstimateItems: [
        {
          id: "estimate-approved",
          estimate_version_id: "version-approved",
          source_takeoff_id: "takeoff-1",
          source_fingerprint: "4 inch sanitary pipe|22-11-00|125|lf||",
        },
      ],
      costCatalog: [],
      projectId: "project-1",
    });

    assert.equal(result.rows.length, 0);
    assert.equal(result.updates.length, 0);
    assert.equal(result.skipped, 1);
  });
});
