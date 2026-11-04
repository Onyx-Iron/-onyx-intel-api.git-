import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { regionFromProject, resolveCost, resolveCostsBatch } from "./resolver.ts";
import { createMemoryDb, type MemoryRow } from "../test-utils/memory-query.ts";

const FRESH = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const CODE = "03 30 00";
const CODE_ID = "code-03";

function codeRow(overrides: MemoryRow = {}): MemoryRow {
  return { id: CODE_ID, csi_code: CODE, uom: "CY", ...overrides };
}

describe("regionFromProject", () => {
  it("normalizes a state, a city alias, and a zip", () => {
    assert.deepEqual(
      regionFromProject({ state: "tx", city: " saint louis ", zip_code: " 75201 " }),
      { zip: "75201", metro: "St. Louis", state: "TX" },
    );
    assert.deepEqual(regionFromProject({ zip_code: "   ", state: "", city: null }), {
      zip: undefined,
      metro: undefined,
      state: undefined,
    });
    assert.deepEqual(regionFromProject(null), { zip: undefined, metro: undefined, state: undefined });
  });
});

describe("cost resolution precedence", () => {
  it("uses the newest region override and does not age a tenant price", async () => {
    const db = createMemoryDb({
      commodity_trend_series: [{ csi_division: "03", pct_change_90d: 10 }],
      cost_codes: [codeRow()],
      cost_overrides: [
        { tenant_id: "tenant-a", cost_code_id: CODE_ID, region_code: "TX", unit_cost: 12, effective_from: "2020-01-01" },
        { tenant_id: "tenant-a", cost_code_id: CODE_ID, region_code: "TX", unit_cost: 15, effective_from: "2024-01-01" },
        { tenant_id: "tenant-a", cost_code_id: CODE_ID, region_code: "TX", unit_cost: "18.50", effective_from: "2025-06-01" },
        { tenant_id: "tenant-a", cost_code_id: CODE_ID, region_code: null, unit_cost: 80, effective_from: "2026-01-01" },
      ],
      cost_actuals: [
        { tenant_id: "tenant-a", csi_code: CODE, actual_unit_cost: 4, observed_at: FRESH, region_code: "TX" },
      ],
      cost_prices: [
        { cost_code_id: CODE_ID, region_code: "TX", unit_cost: 5, observed_at: FRESH },
        { cost_code_id: CODE_ID, region_type: "national", region_code: "US", unit_cost: 1, observed_at: FRESH },
      ],
    });
    const input = { cost_code: CODE, tenant_id: "tenant-a", region: { state: "tx" } };

    const [batched] = await resolveCostsBatch([input], db);
    const single = await resolveCost(input, db);

    for (const result of [batched, single]) {
      assert.equal(result.unit_cost, 18.5);
      assert.equal(result.source, "tenant_override");
      assert.equal(result.price_scope, "tenant");
      assert.equal(result.confidence, "high");
      assert.equal(result.uom, "CY");
      assert.equal(result.ppi_escalated, undefined);
      assert.equal(result.region_code, "TX");
    }
  });

  it("averages in-window actuals for the project state and leaves a fresh average unaged", async () => {
    const db = createMemoryDb({
      commodity_trend_series: [{ csi_division: "03", pct_change_90d: 25 }],
      cost_codes: [codeRow()],
      cost_actuals: [
        { tenant_id: "tenant-a", csi_code: CODE, actual_unit_cost: "10", observed_at: FRESH, region_code: "TX" },
        { tenant_id: "tenant-a", csi_code: CODE, actual_unit_cost: "30", observed_at: FRESH, region_code: "TX" },
        { tenant_id: "tenant-a", csi_code: CODE, actual_unit_cost: 1000, observed_at: "2020-01-01", region_code: "TX" },
        { tenant_id: "tenant-a", csi_code: CODE, actual_unit_cost: 9, observed_at: FRESH, region_code: "CA" },
        { tenant_id: "tenant-b", csi_code: CODE, actual_unit_cost: 7, observed_at: FRESH, region_code: "TX" },
      ],
      cost_prices: [
        { cost_code_id: CODE_ID, region_code: "TX", unit_cost: 5, observed_at: FRESH },
      ],
    });

    const [result] = await resolveCostsBatch(
      [{ cost_code: CODE, tenant_id: "tenant-a", region: { state: "TX" } }],
      db,
    );

    assert.equal(result.unit_cost, 20);
    assert.equal(result.source, "actuals_avg");
    assert.equal(result.price_scope, "actuals");
    assert.equal(result.confidence, "medium");
    assert.equal(result.ppi_escalated, undefined);
    assert.match(result.detail ?? "", /avg of 2 actuals/);
  });

  it("prefers a zip price over a newer state price", async () => {
    const db = createMemoryDb({
      cost_codes: [codeRow({ uom: "LF" })],
      cost_prices: [
        { cost_code_id: CODE_ID, region_code: "75201", unit_cost: 11, labor_cost: 4, observed_at: "2026-01-01" },
        { cost_code_id: CODE_ID, region_code: "TX", unit_cost: 99, observed_at: "2026-10-01" },
        { cost_code_id: CODE_ID, region_type: "national", region_code: "US", unit_cost: 1, observed_at: FRESH },
      ],
    });
    const input = { cost_code: CODE, tenant_id: "tenant-a", region: { zip: "75201", state: "TX" } };

    const [batched] = await resolveCostsBatch([input], db);
    const single = await resolveCost(input, db);

    for (const result of [batched, single]) {
      assert.equal(result.unit_cost, 11);
      assert.equal(result.labor_cost, 4);
      assert.equal(result.source, "regional_price");
      assert.equal(result.price_scope, "regional");
      assert.equal(result.region_code, "75201");
      assert.equal(result.uom, "LF");
    }
  });

  it("moves a national price by a location index and keeps a near-parity index national", async () => {
    const national = {
      cost_code_id: CODE_ID,
      region_type: "national",
      region_code: "US",
      unit_cost: 200,
      labor_cost: 80,
      material_cost: 100,
      equipment_cost: null,
      observed_at: FRESH,
    };
    const indexed = createMemoryDb({
      cost_codes: [codeRow()],
      cost_prices: [national],
      cost_indices: [
        { source: "location_factor", series_code: "location", region_code: "Dallas", index_value: 130, base_value: null, observed_at: FRESH },
        { source: "location_factor", series_code: "location", region_code: "US", index_value: 100, base_value: null, observed_at: FRESH },
      ],
    });
    const [moved] = await resolveCostsBatch(
      [{ cost_code: CODE, tenant_id: "tenant-a", region: { metro: "Dallas" } }],
      indexed,
    );
    assert.equal(moved.unit_cost, 260);
    assert.equal(moved.labor_cost, 104);
    assert.equal(moved.material_cost, 130);
    assert.equal(moved.equipment_cost, undefined);
    assert.equal(moved.source, "regional_price");
    assert.equal(moved.price_scope, "location_index");
    assert.equal(moved.confidence, "medium");

    const flat = createMemoryDb({
      cost_codes: [codeRow()],
      cost_prices: [national],
      cost_indices: [
        { source: "location_factor", series_code: "location", region_code: "Dallas", index_value: 101, base_value: null, observed_at: FRESH },
        { source: "location_factor", series_code: "location", region_code: "US", index_value: 100, base_value: null, observed_at: FRESH },
      ],
    });
    const [unchanged] = await resolveCostsBatch(
      [{ cost_code: CODE, tenant_id: "tenant-a", region: { metro: "Dallas" } }],
      flat,
    );
    assert.equal(unchanged.unit_cost, 200);
    assert.equal(unchanged.labor_cost, 80);
    assert.equal(unchanged.source, "national_price");
    assert.equal(unchanged.price_scope, "national");
    assert.match(unchanged.detail ?? "", /National average/);
  });

  it("ages a stale regional price and lowers confidence", async () => {
    const db = createMemoryDb({
      commodity_trend_series: [{ csi_division: "03", pct_change_90d: "10" }],
      cost_codes: [codeRow({ uom: "LF" })],
      cost_prices: [
        {
          cost_code_id: CODE_ID,
          region_code: "TX",
          unit_cost: 100,
          labor_cost: 40,
          material_cost: 50,
          equipment_cost: 10,
          observed_at: "2020-01-01",
        },
      ],
    });

    const [result] = await resolveCostsBatch(
      [{ cost_code: CODE, tenant_id: "tenant-a", region: { state: "TX" } }],
      db,
    );

    assert.equal(result.unit_cost, 110);
    assert.equal(result.labor_cost, 44);
    assert.equal(result.material_cost, 55);
    assert.equal(result.equipment_cost, 11);
    assert.equal(result.source, "regional_price");
    assert.equal(result.confidence, "low");
    assert.equal(result.ppi_escalated, true);
    assert.equal(result.ppi_pct_applied, 10);
    assert.equal(result.uom, "LF");
  });

  it("resolves each code in a batch and returns nothing for an empty request", async () => {
    const known = { cost_code: CODE, tenant_id: "tenant-a", region: { state: "TX" } };
    const unknown = { cost_code: "99 99 99", tenant_id: "tenant-a", region: { state: "TX" } };
    const duplicate = { cost_code: CODE, tenant_id: "tenant-a", region: { state: "TX" } };
    const db = createMemoryDb({
      cost_codes: [codeRow()],
      cost_prices: [
        { cost_code_id: CODE_ID, region_type: "national", region_code: "US", unit_cost: 50, observed_at: FRESH },
      ],
    });

    assert.deepEqual(await resolveCostsBatch([], db), []);
    const results = await resolveCostsBatch([unknown, known, duplicate], db);
    assert.equal(results[0]?.source, "none");
    assert.equal(results[0]?.unit_cost, 0);
    assert.equal(results[0]?.detail, "unknown cost_code");
    assert.equal(results[1]?.source, "national_price");
    assert.equal(results[1]?.unit_cost, 50);
    assert.equal(results[1]?.price_scope, "national");
    assert.equal(results[2]?.unit_cost, 50);
    assert.notEqual(results[1], results[2]);
  });
});
