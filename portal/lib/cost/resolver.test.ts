import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { regionFromProject, resolveCost, resolveCostsBatch } from "./resolver.ts";

type Row = Record<string, unknown>;

function fakeResolverDb(tables: Record<string, Row[]>) {
  function from(table: string) {
    const state = {
      filters: [] as Array<(row: Row) => boolean>,
      orderBy: null as { col: string; ascending: boolean } | null,
      maxRows: null as number | null,
    };
    const chain: Record<string, unknown> = {};
    const rows = () => {
      let list = (tables[table] ?? []).filter((row) => state.filters.every((filter) => filter(row)));
      if (state.orderBy) {
        const { col, ascending } = state.orderBy;
        list = [...list].sort((a, b) => {
          const left = a[col] == null ? "" : String(a[col]);
          const right = b[col] == null ? "" : String(b[col]);
          const cmp = left < right ? -1 : left > right ? 1 : 0;
          return ascending ? cmp : -cmp;
        });
      }
      if (state.maxRows != null) list = list.slice(0, state.maxRows);
      return list;
    };
    chain.select = () => chain;
    chain.eq = (col: string, val: unknown) => {
      state.filters.push((row) => row[col] === val);
      return chain;
    };
    chain.in = (col: string, vals: unknown[]) => {
      state.filters.push((row) => vals.includes(row[col]));
      return chain;
    };
    chain.is = (col: string, val: unknown) => {
      state.filters.push((row) => row[col] === val);
      return chain;
    };
    chain.gte = (col: string, val: unknown) => {
      state.filters.push((row) => row[col] != null && val != null && String(row[col]) >= String(val));
      return chain;
    };
    chain.or = () => chain;
    chain.order = (col: string, opts?: { ascending?: boolean }) => {
      state.orderBy = { col, ascending: opts?.ascending ?? true };
      return chain;
    };
    chain.limit = (count: number) => {
      state.maxRows = count;
      return chain;
    };
    chain.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    chain.then = (
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return chain;
  }
  return { from };
}

const texas = { zip: "78701", metro: "Austin", state: "TX" };

function catalog(): Record<string, Row[]> {
  return {
    commodity_trend_series: [{ csi_division: "03", pct_change_90d: "10" }],
    cost_codes: [
      { id: "code-concrete", csi_code: "03 30 00", uom: "CY" },
      { id: "code-steel", csi_code: "05 12 00", uom: "TN" },
    ],
    cost_overrides: [],
    cost_actuals: [],
    cost_prices: [],
    cost_indices: [],
  };
}

describe("regionFromProject", () => {
  it("normalizes a project address and leaves a missing project empty", () => {
    assert.deepEqual(
      regionFromProject({ state: "tx", city: "  austin ", zip_code: " 78701 " }),
      { zip: "78701", metro: "Austin", state: "TX" },
    );
    assert.deepEqual(regionFromProject(null), {
      zip: undefined,
      metro: undefined,
      state: undefined,
    });
  });
});

describe("resolveCostsBatch", () => {
  it("returns nothing for an empty request", async () => {
    const results = await resolveCostsBatch([], fakeResolverDb(catalog()));
    assert.deepEqual(results, []);
  });

  it("prefers a region override over a newer company-wide override, actuals, and catalog prices", async () => {
    const tables = catalog();
    tables.cost_overrides = [
      { tenant_id: "tenant-a", cost_code_id: "code-concrete", region_code: null, unit_cost: "80", effective_from: "2026-09-01" },
      { tenant_id: "tenant-a", cost_code_id: "code-concrete", region_code: "TX", unit_cost: "40.50", labor_cost: "10", material_cost: "25.50", equipment_cost: "5", effective_from: "2026-01-01" },
      { tenant_id: "tenant-b", cost_code_id: "code-concrete", region_code: "TX", unit_cost: "999", effective_from: "2026-10-01" },
    ];
    tables.cost_actuals = [
      { tenant_id: "tenant-a", csi_code: "03 30 00", region_code: "TX", actual_unit_cost: 12, observed_at: "2026-10-01" },
    ];
    tables.cost_prices = [
      { cost_code_id: "code-concrete", region_code: "78701", region_type: "zip", unit_cost: 11, observed_at: "2026-10-01" },
      { cost_code_id: "code-concrete", region_code: "US", region_type: "national", unit_cost: 1, observed_at: "2026-10-01" },
    ];

    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(tables),
    );

    assert.equal(priced.unit_cost, 40.5);
    assert.equal(priced.source, "tenant_override");
    assert.equal(priced.price_scope, "tenant");
    assert.equal(priced.confidence, "high");
    assert.equal(priced.region_code, "TX");
    assert.equal(priced.uom, "CY");
    assert.equal(priced.labor_cost, "10");
    assert.equal(priced.material_cost, "25.50");
    assert.equal(priced.equipment_cost, "5");
    assert.equal(priced.ppi_escalated, undefined);
  });

  it("keeps each tenant on its own override when one batch mixes regions", async () => {
    const tables = catalog();
    tables.cost_overrides = [
      { tenant_id: "tenant-a", cost_code_id: "code-concrete", region_code: "TX", unit_cost: 40, effective_from: "2026-08-01" },
    ];
    tables.cost_prices = [
      { cost_code_id: "code-concrete", region_code: "US", region_type: "national", unit_cost: 7, observed_at: "2026-10-01" },
    ];

    const results = await resolveCostsBatch(
      [
        { cost_code: "03 30 00", tenant_id: "tenant-b", region: texas },
        { cost_code: "03 30 00", tenant_id: "tenant-a", region: texas },
      ],
      fakeResolverDb(tables),
    );

    assert.equal(results[0].source, "national_price");
    assert.equal(results[0].unit_cost, 7);
    assert.equal(results[1].source, "tenant_override");
    assert.equal(results[1].unit_cost, 40);
  });

  it("averages recent numeric actuals and ignores observations outside six months", async () => {
    const tables = catalog();
    tables.cost_actuals = [
      { tenant_id: "tenant-a", csi_code: "03 30 00", region_code: "TX", actual_unit_cost: "10.00", observed_at: "2026-09-01" },
      { tenant_id: "tenant-a", csi_code: "03 30 00", region_code: "TX", actual_unit_cost: "20.50", observed_at: "2026-10-15" },
      { tenant_id: "tenant-a", csi_code: "03 30 00", region_code: "TX", actual_unit_cost: 500, observed_at: "2024-01-01" },
      { tenant_id: "tenant-a", csi_code: "03 30 00", region_code: "CA", actual_unit_cost: 80, observed_at: "2026-10-01" },
    ];
    tables.cost_prices = [
      { cost_code_id: "code-concrete", region_code: "US", region_type: "national", unit_cost: 1, observed_at: "2026-10-01" },
    ];

    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(tables),
    );

    assert.equal(priced.source, "actuals_avg");
    assert.equal(priced.price_scope, "actuals");
    assert.equal(priced.unit_cost, 15.25);
    assert.equal(priced.confidence, "medium");
    assert.equal(priced.observed_at, "2026-10-15");
    assert.equal(priced.ppi_escalated, undefined);
  });

  it("uses the zip price before the state price", async () => {
    const tables = catalog();
    tables.cost_prices = [
      { cost_code_id: "code-concrete", region_code: "TX", region_type: "state", unit_cost: 22, observed_at: "2026-10-20" },
      { cost_code_id: "code-concrete", region_code: "78701", region_type: "zip", unit_cost: "11.00", observed_at: "2026-10-20" },
      { cost_code_id: "code-concrete", region_code: "US", region_type: "national", unit_cost: 1, observed_at: "2026-10-01" },
    ];

    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(tables),
    );

    assert.equal(priced.source, "regional_price");
    assert.equal(priced.price_scope, "regional");
    assert.equal(priced.unit_cost, 11);
    assert.equal(priced.region_code, "78701");
    assert.equal(priced.confidence, "medium");
  });

  it("moves a fresh national price by the location index", async () => {
    const tables = catalog();
    tables.cost_prices = [
      {
        cost_code_id: "code-concrete",
        region_code: "US",
        region_type: "national",
        unit_cost: 100,
        labor_cost: 60,
        material_cost: 30,
        equipment_cost: 10,
        observed_at: "2026-10-01",
      },
    ];
    tables.cost_indices = [
      { region_code: "US", index_value: 100, series_code: "cci", source: "enr_cci", observed_at: "2026-09-01" },
      { region_code: "TX", index_value: 110, series_code: "cci", source: "enr_cci", observed_at: "2026-09-01" },
    ];

    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(tables),
    );

    assert.equal(priced.source, "regional_price");
    assert.equal(priced.price_scope, "location_index");
    assert.equal(priced.unit_cost, 110);
    assert.equal(priced.labor_cost, 66);
    assert.equal(priced.material_cost, 33);
    assert.equal(priced.equipment_cost, 11);
    assert.equal(priced.region_code, "TX");
    assert.equal(priced.confidence, "medium");
    assert.match(priced.detail ?? "", /Location index/);
  });

  it("ages a stale national price and scales its cost split", async () => {
    const tables = catalog();
    tables.cost_prices = [
      {
        cost_code_id: "code-concrete",
        region_code: "US",
        region_type: "national",
        unit_cost: "100",
        labor_cost: 60,
        material_cost: 30,
        equipment_cost: 10,
        observed_at: "2026-01-01",
      },
    ];

    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(tables),
    );

    assert.equal(priced.source, "national_price");
    assert.equal(priced.price_scope, "national");
    assert.equal(priced.unit_cost, 110);
    assert.equal(priced.labor_cost, 66);
    assert.equal(priced.material_cost, 33);
    assert.equal(priced.equipment_cost, 11);
    assert.equal(priced.ppi_escalated, true);
    assert.equal(priced.ppi_pct_applied, 10);
    assert.equal(priced.confidence, "low");
    assert.match(priced.detail ?? "", /PPI-aged/);
  });

  it("drops a numeric-string cost split when a stale catalog price is aged", async () => {
    const tables = catalog();
    tables.cost_prices = [
      {
        cost_code_id: "code-concrete",
        region_code: "US",
        region_type: "national",
        unit_cost: 100,
        labor_cost: "60",
        material_cost: "30",
        equipment_cost: "10",
        observed_at: "2026-01-01",
      },
    ];

    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(tables),
    );

    assert.equal(priced.unit_cost, 110);
    assert.equal(priced.labor_cost, undefined);
    assert.equal(priced.material_cost, undefined);
    assert.equal(priced.equipment_cost, undefined);
  });

  it("drops confidence when a stale regional price is aged", async () => {
    const tables = catalog();
    tables.cost_prices = [
      { cost_code_id: "code-concrete", region_code: "TX", region_type: "state", unit_cost: 50, observed_at: "2026-01-01" },
    ];

    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(tables),
    );

    assert.equal(priced.unit_cost, 55);
    assert.equal(priced.confidence, "low");
    assert.equal(priced.ppi_escalated, true);
  });

  it("reports an unknown code without blocking a known code in the same batch", async () => {
    const tables = catalog();
    tables.cost_prices = [
      { cost_code_id: "code-steel", region_code: "US", region_type: "national", unit_cost: 900, observed_at: "2026-10-01" },
    ];

    const results = await resolveCostsBatch(
      [
        { cost_code: "99 99 99", tenant_id: "tenant-a", region: texas },
        { cost_code: "05 12 00", tenant_id: "tenant-a", region: texas },
      ],
      fakeResolverDb(tables),
    );

    assert.equal(results[0].source, "none");
    assert.equal(results[0].detail, "unknown cost_code");
    assert.equal(results[0].unit_cost, 0);
    assert.equal(results[1].source, "national_price");
    assert.equal(results[1].unit_cost, 900);
    assert.equal(results[1].uom, "TN");
  });

  it("returns none when a known code has no price", async () => {
    const [priced] = await resolveCostsBatch(
      [{ cost_code: "03 30 00", tenant_id: "tenant-a", region: texas }],
      fakeResolverDb(catalog()),
    );
    assert.equal(priced.source, "none");
    assert.equal(priced.detail, "no pricing data available");
  });
});

describe("resolveCost", () => {
  it("uses the same region override and leaves it unaged", async () => {
    const tables = catalog();
    tables.cost_overrides = [
      { tenant_id: "tenant-a", cost_code_id: "code-concrete", region_code: "TX", unit_cost: "40", effective_from: "2026-01-01" },
      { tenant_id: "tenant-a", cost_code_id: "code-concrete", region_code: null, unit_cost: "80", effective_from: "2026-10-01" },
    ];

    const priced = await resolveCost(
      { cost_code: "03 30 00", tenant_id: "tenant-a", region: texas },
      fakeResolverDb(tables),
    );

    assert.equal(priced.unit_cost, 40);
    assert.equal(priced.source, "tenant_override");
    assert.equal(priced.ppi_escalated, undefined);
    assert.equal(priced.uom, "CY");
  });

  it("falls back to a company-wide override when the project region has none", async () => {
    const tables = catalog();
    tables.cost_overrides = [
      { tenant_id: "tenant-a", cost_code_id: "code-concrete", region_code: null, unit_cost: "80.25", effective_from: "2026-02-01" },
      { tenant_id: "tenant-a", cost_code_id: "code-concrete", region_code: null, unit_cost: "70", effective_from: "2025-01-01" },
    ];

    const priced = await resolveCost(
      { cost_code: "03 30 00", tenant_id: "tenant-a", region: texas },
      fakeResolverDb(tables),
    );

    assert.equal(priced.unit_cost, 80.25);
    assert.equal(priced.region_code, undefined);
    assert.equal(priced.ppi_escalated, undefined);
  });

  it("scores a single recent actual as medium and records the score", async () => {
    const tables = catalog();
    tables.cost_actuals = [
      { tenant_id: "tenant-a", csi_code: "03 30 00", region_code: "TX", actual_unit_cost: "18", observed_at: "2026-10-01" },
    ];

    const priced = await resolveCost(
      { cost_code: "03 30 00", tenant_id: "tenant-a", region: texas },
      fakeResolverDb(tables),
    );

    assert.equal(priced.source, "actuals_avg");
    assert.equal(priced.unit_cost, 18);
    assert.equal(priced.confidence, "medium");
    assert.match(priced.detail ?? "", /confidence_score=/);
  });

  it("returns none for an unknown cost code", async () => {
    const priced = await resolveCost(
      { cost_code: "99 99 99", tenant_id: "tenant-a", region: texas },
      fakeResolverDb(catalog()),
    );
    assert.equal(priced.source, "none");
    assert.equal(priced.price_scope, "none");
    assert.equal(priced.detail, "unknown cost_code");
  });
});
