import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { syncTakeoffToEstimate } from "./auto-sync.ts";
import { createMemoryDb, type MemoryQueryFailure, type MemoryRow } from "../test-utils/memory-query.ts";

const TENANT = "tenant-a";
const PROJECT = "project-1";
const ESTIMATE = "est-1";
const VERSION = "ver-1";

function projectRows(extra: Record<string, MemoryRow[]> = {}, fail?: MemoryQueryFailure[]) {
  return createMemoryDb({
    estimates: [{
      id: ESTIMATE,
      tenant_id: TENANT,
      project_id: PROJECT,
      current_version_id: VERSION,
      created_at: "2026-01-01",
    }],
    estimate_versions: [{
      id: VERSION,
      estimate_id: ESTIMATE,
      status: "draft",
      contingency_pct: 0,
      overhead_pct: 0,
      profit_pct: 0,
    }],
    projects: [{ id: PROJECT, tenant_id: TENANT, state: "TX", city: "Dallas", zip_code: "75201" }],
    cost_catalog: [{ tenant_id: TENANT, csi_code: "03 30 00", uom: "CY", unit_cost: 25 }],
    sheet_calibrations: [],
    takeoff_items: [],
    estimate_items: [],
    ...extra,
  }, { fail });
}

function takeoff(overrides: MemoryRow): MemoryRow {
  return {
    id: "takeoff",
    label: "Concrete",
    csi_code: "03 30 00",
    division: "03",
    quantity: 1,
    unit: "CY",
    type: "area",
    meta: null,
    review_status: "approved",
    source_method: "deterministic",
    sheet_id: null,
    tenant_id: TENANT,
    project_id: PROJECT,
    ...overrides,
  };
}

describe("syncTakeoffToEstimate", () => {
  it("prices approved rows and holds manual rows whose sheet scale is not verified", async () => {
    const db = projectRows({
      sheet_calibrations: [
        { page_id: "page-scaled", tenant_id: TENANT, project_id: PROJECT, verified: true, status: "verified", active: true, page_space_scale_factor: 0.1 },
        { page_id: "page-null", tenant_id: TENANT, project_id: PROJECT, verified: true, status: "verified", active: true, page_space_scale_factor: null },
        { page_id: "page-open", tenant_id: TENANT, project_id: PROJECT, verified: true, status: "needs_verification", active: true, page_space_scale_factor: 0.1 },
      ],
      takeoff_items: [
        takeoff({ id: "measured", quantity: 4, source_method: "deterministic" }),
        takeoff({ id: "scaled-manual", quantity: 2, source_method: "manual", sheet_id: "page-scaled" }),
        takeoff({ id: "pixel-manual", quantity: 400, source_method: "manual", sheet_id: "page-raw" }),
        takeoff({ id: "null-scale", quantity: 8, source_method: "manual", sheet_id: "page-null" }),
        takeoff({ id: "unconfirmed", quantity: 8, source_method: "manual", sheet_id: "page-open" }),
        takeoff({ id: "suggested", quantity: 9, review_status: "suggested", source_method: "ai_vision" }),
      ],
    });

    const result = await syncTakeoffToEstimate(TENANT, PROJECT, db);

    assert.equal(result.imported, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.pendingReview, 1);
    assert.equal(result.estimateId, ESTIMATE);
    assert.equal(result.versionId, VERSION);
    const inserted = db.rows.estimate_items ?? [];
    assert.deepEqual(
      inserted.map((row) => row.source_takeoff_id).sort(),
      ["measured", "scaled-manual"],
    );
    const measured = inserted.find((row) => row.source_takeoff_id === "measured");
    const manual = inserted.find((row) => row.source_takeoff_id === "scaled-manual");
    assert.equal(measured?.unit_cost, 25);
    assert.equal(measured?.material_cost, 100);
    assert.equal(measured?.labor_cost, 0);
    assert.equal(measured?.equipment_cost, 0);
    assert.equal(measured?.pricing_status, "priced");
    assert.equal(measured?.tenant_id, TENANT);
    assert.equal(manual?.material_cost, 50);
    assert.equal(manual?.unit_cost, 25);
  });

  it("keeps an estimator unit rate when the quantity changes", async () => {
    const db = projectRows({
      cost_catalog: [{ tenant_id: TENANT, csi_code: "03 30 00", uom: "LF", unit_cost: 999 }],
      estimate_items: [{
        id: "line-1",
        tenant_id: TENANT,
        project_id: PROJECT,
        estimate_version_id: VERSION,
        source_takeoff_id: "wall",
        source_fingerprint: "stale",
        quantity: 10,
        unit_cost: 40,
        labor_cost: 100,
        material_cost: 300,
        equipment_cost: 0,
        created_by: "estimator",
      }],
      takeoff_items: [
        takeoff({ id: "wall", label: "Wall", quantity: 20, unit: "LF", source_method: "deterministic" }),
      ],
    });

    const result = await syncTakeoffToEstimate(TENANT, PROJECT, db);

    assert.equal(result.imported, 0);
    assert.equal(result.updated, 1);
    assert.equal(db.rows.estimate_items?.length, 1);
    const line = db.rows.estimate_items?.[0];
    assert.equal(line?.quantity, 20);
    assert.equal(line?.unit_cost, 40);
    assert.equal(line?.labor_cost, 200);
    assert.equal(line?.material_cost, 600);
    assert.equal(line?.equipment_cost, 0);
    assert.equal(line?.total_direct_cost, 800);
    assert.equal(line?.total_price, 800);
    assert.equal(line?.created_by, "estimator");
    assert.equal(line?.updated_by, "system_takeoff_sync");
    assert.equal(line?.tenant_id, TENANT);
  });

  it("does not rewrite a line that belongs to another tenant", async () => {
    const db = projectRows({
      estimate_items: [{
        id: "line-1",
        tenant_id: "tenant-b",
        project_id: PROJECT,
        estimate_version_id: VERSION,
        source_takeoff_id: "wall",
        source_fingerprint: "stale",
        quantity: 10,
        unit_cost: 40,
        labor_cost: 100,
        material_cost: 300,
        equipment_cost: 0,
        created_by: "other",
      }],
      takeoff_items: [
        takeoff({ id: "wall", quantity: 20, unit: "LF" }),
      ],
    });

    const result = await syncTakeoffToEstimate(TENANT, PROJECT, db);

    assert.equal(result.updated, 0);
    assert.equal(result.imported, 0);
    const line = db.rows.estimate_items?.[0];
    assert.equal(line?.quantity, 10);
    assert.equal(line?.unit_cost, 40);
    assert.equal(line?.tenant_id, "tenant-b");
    assert.equal(line?.created_by, "other");
  });

  it("writes nothing when the takeoff or catalog read fails", async () => {
    for (const table of ["takeoff_items", "cost_catalog"]) {
      const db = projectRows(
        { takeoff_items: [takeoff({ id: "measured", quantity: 4 })] },
        [{ table, op: "select" }],
      );
      const result = await syncTakeoffToEstimate(TENANT, PROJECT, db);
      assert.equal(result.imported, 0, table);
      assert.equal(result.updated, 0, table);
      assert.equal(result.priced, 0, table);
      assert.equal(result.estimateId, ESTIMATE, table);
      assert.equal(db.rows.estimate_items?.length ?? 0, 0, table);
    }
  });

  it("holds manual rows when verified scales cannot be read", async () => {
    const db = projectRows(
      {
        sheet_calibrations: [
          { page_id: "page-scaled", tenant_id: TENANT, project_id: PROJECT, verified: true, status: "verified", active: true, page_space_scale_factor: 0.1 },
        ],
        takeoff_items: [
          takeoff({ id: "measured", quantity: 4 }),
          takeoff({ id: "scaled-manual", quantity: 2, source_method: "manual", sheet_id: "page-scaled" }),
        ],
      },
      [{ table: "sheet_calibrations", op: "select" }],
    );

    const result = await syncTakeoffToEstimate(TENANT, PROJECT, db);

    assert.equal(result.imported, 1);
    assert.deepEqual(
      (db.rows.estimate_items ?? []).map((row) => row.source_takeoff_id),
      ["measured"],
    );
  });

  it("reports no import when the estimate insert fails", async () => {
    const db = projectRows(
      { takeoff_items: [takeoff({ id: "measured", quantity: 4 })] },
      [{ table: "estimate_items", op: "insert" }],
    );

    const result = await syncTakeoffToEstimate(TENANT, PROJECT, db);

    assert.equal(result.imported, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.priced, 0);
    assert.equal(db.rows.estimate_items?.length ?? 0, 0);
  });
});
