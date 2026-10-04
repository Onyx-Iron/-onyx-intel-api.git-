import { createServiceClient } from "@/lib/supabase/server";
import {
  actualsNeedPpiAging,
  escalateStaleUnitCost,
  scaleOptionalCost,
  type EscalateResult,
} from "@/lib/cost/ppi";
import { scoreCostConfidence } from "@/lib/cost/confidence";
import { scaleMoney, selectLocationFactor, type LocationIndexRow } from "@/lib/cost/location-adjust";
import { normalizeRegionToken, regionCodeAliases } from "@/lib/cost/region-code";

export interface CostResolveInput {
  cost_code: string;
  tenant_id: string;
  region: { zip?: string; state?: string; metro?: string };
}

export type PriceScope = "tenant" | "actuals" | "regional" | "location_index" | "national" | "none";

export function regionFromProject(project: {
  state?: string | null;
  city?: string | null;
  zip_code?: string | null;
} | null | undefined): CostResolveInput["region"] {
  return {
    zip: project?.zip_code?.trim() || undefined,
    metro: normalizeRegionToken(project?.city),
    state: normalizeRegionToken(project?.state),
  };
}

export interface CostResolveResult {
  cost_code: string;
  unit_cost: number;
  source:
    | "tenant_override"
    | "actuals_avg"
    | "regional_price"
    | "national_price"
    | "none";
  /** What the number actually represents. A national scope is not a local bid. */
  price_scope: PriceScope;
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
  confidence: "high" | "medium" | "low";
  observed_at?: string;
  region_code?: string;
  detail?: string;
  /** Unit on the cost code. A rate is not applied to a different unit. */
  uom?: string | null;
  /** True when unit_cost was aged by commodity PPI at resolve time. */
  ppi_escalated?: boolean;
  ppi_pct_applied?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPctChangeByDivision(db: any): Promise<Map<string, number>> {
  const { data } = await db
    .from("commodity_trend_series")
    .select("csi_division, pct_change_90d");
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const div = typeof row.csi_division === "string" ? row.csi_division.trim() : "";
    const pct = Number(row.pct_change_90d);
    if (div && Number.isFinite(pct)) map.set(div, pct);
  }
  return map;
}

function applyPpiAging(
  result: CostResolveResult,
  pctChangeByDivision: Map<string, number>,
  uom?: string | null,
): CostResolveResult {
  // Tenant overrides are human-authored — never silently age them at read time.
  // Actuals / regional / national catalog prices age when stale.
  const stamped = { ...result, uom: uom ?? result.uom ?? null };
  if (stamped.source === "tenant_override" || stamped.source === "none") return stamped;
  // Actuals already average the last six months. Do not PPI-age that window.
  if (stamped.source === "actuals_avg" && !actualsNeedPpiAging(stamped.observed_at)) return stamped;

  const aged: EscalateResult = escalateStaleUnitCost({
    unitCost: result.unit_cost,
    observedAt: result.observed_at,
    csiCodeOrDivision: result.cost_code,
    pctChangeByDivision,
  });
  if (!aged.escalated) return stamped;

  const from = stamped.unit_cost;
  return {
    ...stamped,
    unit_cost: aged.unitCost,
    labor_cost: scaleOptionalCost(result.labor_cost, from, aged.unitCost),
    material_cost: scaleOptionalCost(result.material_cost, from, aged.unitCost),
    equipment_cost: scaleOptionalCost(result.equipment_cost, from, aged.unitCost),
    ppi_escalated: true,
    ppi_pct_applied: aged.pctApplied ?? undefined,
    detail: [
      result.detail,
      `PPI-aged +${aged.pctApplied?.toFixed(2)}% (div ${aged.division})`,
    ]
      .filter(Boolean)
      .join("; "),
    // Confidence drops one notch when we age a catalog price.
    confidence: result.confidence === "high" ? "medium" : "low",
  };
}

// Pure resolver — precedence: tenant override (region-specific → any) →
// tenant actuals last 6 months → regional cost_prices (zip → metro → state) →
// national cost_prices → none.
export async function resolveCost(
  input: CostResolveInput,
): Promise<CostResolveResult> {
  const { cost_code, tenant_id, region } = input;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createServiceClient()) as any;
  const pctChangeByDivision = await loadPctChangeByDivision(db);

  // 1) Look up cost_code row
  const { data: codeRow } = await db
    .from("cost_codes")
    .select("id, csi_code, uom")
    .eq("csi_code", cost_code)
    .maybeSingle();

  if (!codeRow?.id) {
    return {
      cost_code,
      unit_cost: 0,
      source: "none",
      price_scope: "none",
      confidence: "low",
      detail: "unknown cost_code",
    };
  }
  const codeId: string = codeRow.id;
  const codeUom = typeof codeRow.uom === "string" ? codeRow.uom : null;

  // Candidate region codes in priority order
  const zip = region.zip?.trim();
  const metro = normalizeRegionToken(region.metro);
  const state = normalizeRegionToken(region.state);
  const regionCandidates = [...new Set([
    ...regionCodeAliases(zip),
    ...regionCodeAliases(metro),
    ...regionCodeAliases(state),
  ])];

  // 2) Tenant override — region-specific first
  if (regionCandidates.length > 0) {
    const { data: ovRegion } = await db
      .from("cost_overrides")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("cost_code_id", codeId)
      .in("region_code", regionCandidates)
      .order("effective_from", { ascending: false })
      .limit(1);
    if (ovRegion && ovRegion.length > 0) {
      const r = ovRegion[0];
      return applyPpiAging({
        cost_code,
        unit_cost: Number(r.unit_cost),
        labor_cost: r.labor_cost ?? undefined,
        material_cost: r.material_cost ?? undefined,
        equipment_cost: r.equipment_cost ?? undefined,
        source: "tenant_override",
        price_scope: "tenant",
        confidence: "high",
        observed_at: r.effective_from,
        region_code: r.region_code ?? undefined,
      }, pctChangeByDivision, codeUom);
    }
  }

  // 3) Tenant override — any region (null)
  const { data: ovAny } = await db
    .from("cost_overrides")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("cost_code_id", codeId)
    .is("region_code", null)
    .order("effective_from", { ascending: false })
    .limit(1);
  if (ovAny && ovAny.length > 0) {
    const r = ovAny[0];
    return applyPpiAging({
      cost_code,
      unit_cost: Number(r.unit_cost),
      labor_cost: r.labor_cost ?? undefined,
      material_cost: r.material_cost ?? undefined,
      equipment_cost: r.equipment_cost ?? undefined,
      source: "tenant_override",
      price_scope: "tenant",
      confidence: "high",
      observed_at: r.effective_from,
    }, pctChangeByDivision, codeUom);
  }

  // 4) Tenant actuals — last 6 months, same csi_code + state
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().slice(0, 10);
  let actualsQuery = db
    .from("cost_actuals")
    .select("actual_unit_cost, observed_at, region_code")
    .eq("tenant_id", tenant_id)
    .eq("csi_code", cost_code)
    .gte("observed_at", sixMonthsAgoStr);
  const stateAliases = regionCodeAliases(state);
  if (stateAliases.length > 0) actualsQuery = actualsQuery.in("region_code", stateAliases);
  const { data: actuals } = await actualsQuery;
  if (actuals && actuals.length > 0) {
    const n = actuals.length;
    const avg =
      actuals.reduce(
        (s: number, a: { actual_unit_cost: number | string }) =>
          s + Number(a.actual_unit_cost),
        0,
      ) / n;
    const newest = actuals.reduce(
      (best: string | undefined, a: { observed_at?: string }) => {
        if (!a.observed_at) return best;
        if (!best || a.observed_at > best) return a.observed_at;
        return best;
      },
      undefined as string | undefined,
    );
    // Multi-source confidence helper (Company Hub M6) — ages + variance aware.
    const scored = scoreCostConfidence(
      (actuals as Array<{ actual_unit_cost: number | string; observed_at?: string | null }>).map((a) => ({
        unitCost: Number(a.actual_unit_cost),
        observedAt: a.observed_at ?? null,
        source: "tenant_actual",
      })),
    );
    return applyPpiAging({
      cost_code,
      unit_cost: avg,
      source: "actuals_avg",
      price_scope: "actuals",
      confidence: scored.confidence,
      detail: `avg of ${n} actuals (last 6mo); confidence_score=${scored.score}`,
      region_code: state,
      observed_at: newest,
    }, pctChangeByDivision, codeUom);
  }

  // 5) Regional cost_prices — try zip, metro, state in order
  for (const rc of regionCandidates) {
    const { data: regional } = await db
      .from("cost_prices")
      .select("*")
      .eq("cost_code_id", codeId)
      .eq("region_code", rc)
      .order("observed_at", { ascending: false })
      .limit(1);
    if (regional && regional.length > 0) {
      const r = regional[0];
      return applyPpiAging({
        cost_code,
        unit_cost: Number(r.unit_cost),
        labor_cost: r.labor_cost ?? undefined,
        material_cost: r.material_cost ?? undefined,
        equipment_cost: r.equipment_cost ?? undefined,
        source: "regional_price",
        price_scope: "regional",
        confidence: "medium",
        observed_at: r.observed_at,
        region_code: rc,
      }, pctChangeByDivision, codeUom);
    }
  }

  // 6) National, adjusted by a current location index when one exists.
  const { data: nat } = await db
    .from("cost_prices")
    .select("*")
    .eq("cost_code_id", codeId)
    .eq("region_type", "national")
    .order("observed_at", { ascending: false })
    .limit(1);
  if (nat && nat.length > 0) {
    const indexes = await loadLocationRows(db, regionCandidates);
    return nationalOrIndexed(cost_code, nat[0], indexes, regionCandidates, pctChangeByDivision, codeUom);
  }

  return {
    cost_code,
    unit_cost: 0,
    source: "none",
    price_scope: "none",
    confidence: "low",
    detail: "no pricing data available",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadLocationRows(db: any, regionCandidates: string[]): Promise<LocationIndexRow[]> {
  if (regionCandidates.length === 0) return [];
  const codes = [...new Set([...regionCandidates, "US", "USA", "NATIONAL"])];
  const { data } = await db
    .from("cost_indices")
    .select("source, series_code, region_code, index_value, base_value, observed_at")
    .in("region_code", codes)
    .or("series_code.in.(location,cci,lci),source.in.(enr_cci,rsmeans_lci,location_factor)")
    .order("observed_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    source: typeof row.source === "string" ? row.source : null,
    seriesCode: typeof row.series_code === "string" ? row.series_code : null,
    regionCode: String(row.region_code ?? ""),
    indexValue: Number(row.index_value),
    baseValue: row.base_value == null ? null : Number(row.base_value),
    observedAt: typeof row.observed_at === "string" ? row.observed_at : null,
  }));
}

function nationalOrIndexed(
  costCode: string,
  national: Row,
  indexes: LocationIndexRow[],
  regionCandidates: string[],
  pctChangeByDivision: Map<string, number>,
  uom?: string | null,
): CostResolveResult {
  const factor = selectLocationFactor({ rows: indexes, regionCandidates });
  if (factor) {
    return applyPpiAging({
      cost_code: costCode,
      unit_cost: scaleMoney(Number(national.unit_cost), factor.factor),
      labor_cost: national.labor_cost == null ? undefined : scaleMoney(Number(national.labor_cost), factor.factor),
      material_cost: national.material_cost == null ? undefined : scaleMoney(Number(national.material_cost), factor.factor),
      equipment_cost: national.equipment_cost == null ? undefined : scaleMoney(Number(national.equipment_cost), factor.factor),
      source: "regional_price",
      price_scope: "location_index",
      confidence: "medium",
      observed_at: national.observed_at,
      region_code: factor.regionCode,
      detail: factor.detail,
    }, pctChangeByDivision, uom);
  }
  return applyPpiAging({
    cost_code: costCode,
    unit_cost: Number(national.unit_cost),
    labor_cost: national.labor_cost ?? undefined,
    material_cost: national.material_cost ?? undefined,
    equipment_cost: national.equipment_cost ?? undefined,
    source: "national_price",
    price_scope: "national",
    confidence: "low",
    observed_at: national.observed_at,
    region_code: national.region_code,
    detail: "National average. No regional price or location index for this project.",
  }, pctChangeByDivision, uom);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function regionKey(input: CostResolveInput): string {
  return `${input.tenant_id}|${input.region.zip ?? ""}|${input.region.metro ?? ""}|${input.region.state ?? ""}`;
}

/**
 * Batched version of resolveCost() for resolving many cost codes at once
 * (e.g. every line item in a takeoff import). The single-code resolveCost()
 * above issues up to 6 sequential round trips PER code — for a 50-line
 * takeoff that's ~250-300 serialized Supabase calls. This groups inputs that
 * share a tenant+region (the common case: one HTTP request resolving many
 * codes for one project) and does each of the 5 lookup stages as a single
 * `.in(...)` query, resolving precedence in memory instead of per-code.
 */
export async function resolveCostsBatch(
  inputs: CostResolveInput[],
): Promise<CostResolveResult[]> {
  if (inputs.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createServiceClient()) as any;
  const pctChangeByDivision = await loadPctChangeByDivision(db);

  const results = new Map<CostResolveInput, CostResolveResult>();

  const groups = new Map<string, CostResolveInput[]>();
  for (const input of inputs) {
    const key = regionKey(input);
    const group = groups.get(key);
    if (group) group.push(input);
    else groups.set(key, [input]);
  }

  for (const group of groups.values()) {
    const { tenant_id, region } = group[0];
    const zip = region.zip?.trim();
    const metro = normalizeRegionToken(region.metro);
    const state = normalizeRegionToken(region.state);
    const regionCandidates = [...new Set([
      ...regionCodeAliases(zip),
      ...regionCodeAliases(metro),
      ...regionCodeAliases(state),
    ])];

    const codes = [...new Set(group.map((g) => g.cost_code))];

    // Stage 1: resolve all cost_code rows in one query.
    const { data: codeRows } = await db
      .from("cost_codes")
    .select("id, csi_code, uom")
    .in("csi_code", codes);
    const codeIdByCsi = new Map<string, string>(
      (codeRows ?? []).map((r: Row) => [r.csi_code, r.id]),
    );
    const uomByCsi = new Map<string, string | null>(
      (codeRows ?? []).map((r: Row) => [r.csi_code, typeof r.uom === "string" ? r.uom : null]),
    );
    const codeIds = [...codeIdByCsi.values()];

    const missingCodes = codes.filter((c) => !codeIdByCsi.has(c));
    for (const c of missingCodes) {
      for (const input of group.filter((g) => g.cost_code === c)) {
        results.set(input, {
          cost_code: c,
          unit_cost: 0,
          source: "none",
          price_scope: "none",
          confidence: "low",
          detail: "unknown cost_code",
        });
      }
    }
    if (codeIds.length === 0) continue;

    // Stage 2+3: all tenant overrides (region-specific + any-region) for
    // every code id in this group, in one query — precedence resolved below.
    const { data: overrides } = await db
      .from("cost_overrides")
      .select("*")
      .eq("tenant_id", tenant_id)
      .in("cost_code_id", codeIds)
      .order("effective_from", { ascending: false });
    const overridesByCodeId = new Map<string, Row[]>();
    for (const r of (overrides ?? []) as Row[]) {
      const list = overridesByCodeId.get(r.cost_code_id) ?? [];
      list.push(r);
      overridesByCodeId.set(r.cost_code_id, list);
    }

    // Stage 4: all tenant actuals for every csi_code in this group, last 6mo,
    // in one query.
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().slice(0, 10);
    let actualsQuery = db
      .from("cost_actuals")
      .select("actual_unit_cost, observed_at, region_code, csi_code")
      .eq("tenant_id", tenant_id)
      .in("csi_code", codes)
      .gte("observed_at", sixMonthsAgoStr);
    const stateAliases = regionCodeAliases(state);
    if (stateAliases.length > 0) actualsQuery = actualsQuery.in("region_code", stateAliases);
    const { data: actuals } = await actualsQuery;
    const actualsByCsi = new Map<string, Row[]>();
    for (const r of (actuals ?? []) as Row[]) {
      const list = actualsByCsi.get(r.csi_code) ?? [];
      list.push(r);
      actualsByCsi.set(r.csi_code, list);
    }

    // Stage 5: regional cost_prices for every code id + every candidate
    // region, in one query.
    const regionalPricesByCodeId = new Map<string, Row[]>();
    if (regionCandidates.length > 0) {
      const { data: regional } = await db
        .from("cost_prices")
        .select("*")
        .in("cost_code_id", codeIds)
        .in("region_code", regionCandidates)
        .order("observed_at", { ascending: false });
      for (const r of (regional ?? []) as Row[]) {
        const list = regionalPricesByCodeId.get(r.cost_code_id) ?? [];
        list.push(r);
        regionalPricesByCodeId.set(r.cost_code_id, list);
      }
    }

    // Stage 6: national cost_prices for every code id, in one query.
    const { data: national } = await db
      .from("cost_prices")
      .select("*")
      .in("cost_code_id", codeIds)
      .eq("region_type", "national")
      .order("observed_at", { ascending: false });
    const nationalByCodeId = new Map<string, Row>();
    for (const r of (national ?? []) as Row[]) {
      if (!nationalByCodeId.has(r.cost_code_id)) nationalByCodeId.set(r.cost_code_id, r);
    }
    const locationRows = await loadLocationRows(db, regionCandidates);

    for (const input of group) {
      const { cost_code } = input;
      if (results.has(input)) continue; // already resolved as "unknown cost_code" above
      const codeId = codeIdByCsi.get(cost_code)!;
      const codeUom = uomByCsi.get(cost_code) ?? null;

      // Precedence 2/3: tenant override, region-specific first, then any-region.
      const codeOverrides = overridesByCodeId.get(codeId) ?? [];
      const regionOverride = regionCandidates.length > 0
        ? codeOverrides.find((r) => r.region_code && regionCandidates.includes(r.region_code))
        : undefined;
      const anyOverride = regionOverride ?? codeOverrides.find((r) => !r.region_code);
      if (anyOverride) {
        results.set(input, applyPpiAging({
          cost_code,
          unit_cost: Number(anyOverride.unit_cost),
          labor_cost: anyOverride.labor_cost ?? undefined,
          material_cost: anyOverride.material_cost ?? undefined,
          equipment_cost: anyOverride.equipment_cost ?? undefined,
          source: "tenant_override",
          price_scope: "tenant",
          confidence: "high",
          observed_at: anyOverride.effective_from,
          region_code: anyOverride.region_code ?? undefined,
        }, pctChangeByDivision, codeUom));
        continue;
      }

      // Precedence 4: tenant actuals average.
      const codeActuals = actualsByCsi.get(cost_code) ?? [];
      if (codeActuals.length > 0) {
        const n = codeActuals.length;
        const avg = codeActuals.reduce((s, a) => s + Number(a.actual_unit_cost), 0) / n;
        const newest = codeActuals.reduce((best: string | undefined, a) => {
          if (!a.observed_at) return best;
          if (!best || a.observed_at > best) return a.observed_at;
          return best;
        }, undefined as string | undefined);
        results.set(input, applyPpiAging({
          cost_code,
          unit_cost: avg,
          source: "actuals_avg",
          price_scope: "actuals",
          confidence: n >= 3 ? "high" : "medium",
          detail: `avg of ${n} actuals (last 6mo)`,
          region_code: state,
          observed_at: newest,
        }, pctChangeByDivision, codeUom));
        continue;
      }

      // Precedence 5: regional cost_prices, in candidate priority order (zip > metro > state).
      const codeRegional = regionalPricesByCodeId.get(codeId) ?? [];
      const regional = regionCandidates
        .map((rc) => codeRegional.find((r) => r.region_code === rc))
        .find((r) => r != null);
      if (regional) {
        results.set(input, applyPpiAging({
          cost_code,
          unit_cost: Number(regional.unit_cost),
          labor_cost: regional.labor_cost ?? undefined,
          material_cost: regional.material_cost ?? undefined,
          equipment_cost: regional.equipment_cost ?? undefined,
          source: "regional_price",
          price_scope: "regional",
          confidence: "medium",
          observed_at: regional.observed_at,
          region_code: regional.region_code,
        }, pctChangeByDivision, codeUom));
        continue;
      }

      // Precedence 6: national, or that national price moved by a location index.
      const nat = nationalByCodeId.get(codeId);
      if (nat) {
        results.set(input, nationalOrIndexed(cost_code, nat, locationRows, regionCandidates, pctChangeByDivision, codeUom));
        continue;
      }

      results.set(input, {
        cost_code,
        unit_cost: 0,
        source: "none",
        price_scope: "none",
        confidence: "low",
        detail: "no pricing data available",
      });
    }
  }

  return inputs.map((input) => results.get(input)!);
}
