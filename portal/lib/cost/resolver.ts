import { createServiceClient } from "@/lib/supabase/server";
import {
  escalateStaleUnitCost,
  scaleOptionalCost,
  type EscalateResult,
} from "@/lib/cost/ppi";

export interface CostResolveInput {
  cost_code: string;
  tenant_id: string;
  region: { zip?: string; state?: string; metro?: string };
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
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
  confidence: "high" | "medium" | "low";
  observed_at?: string;
  region_code?: string;
  detail?: string;
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
): CostResolveResult {
  // Tenant overrides are human-authored — never silently age them at read time.
  // Actuals / regional / national catalog prices age when stale.
  if (result.source === "tenant_override" || result.source === "none") return result;

  const aged: EscalateResult = escalateStaleUnitCost({
    unitCost: result.unit_cost,
    observedAt: result.observed_at,
    csiCodeOrDivision: result.cost_code,
    pctChangeByDivision,
  });
  if (!aged.escalated) return result;

  const from = result.unit_cost;
  return {
    ...result,
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
    .select("id, csi_code")
    .eq("csi_code", cost_code)
    .maybeSingle();

  if (!codeRow?.id) {
    return {
      cost_code,
      unit_cost: 0,
      source: "none",
      confidence: "low",
      detail: "unknown cost_code",
    };
  }
  const codeId: string = codeRow.id;

  // Candidate region codes in priority order
  const zip = region.zip?.trim();
  const metro = region.metro?.trim();
  const state = region.state?.trim();
  const regionCandidates: string[] = [];
  if (zip) regionCandidates.push(zip);
  if (metro) regionCandidates.push(metro);
  if (state) regionCandidates.push(state);

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
        confidence: "high",
        observed_at: r.effective_from,
        region_code: r.region_code ?? undefined,
      }, pctChangeByDivision);
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
      confidence: "high",
      observed_at: r.effective_from,
    }, pctChangeByDivision);
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
  if (state) actualsQuery = actualsQuery.eq("region_code", state);
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
    return applyPpiAging({
      cost_code,
      unit_cost: avg,
      source: "actuals_avg",
      confidence: n >= 3 ? "high" : "medium",
      detail: `avg of ${n} actuals (last 6mo)`,
      region_code: state,
      observed_at: newest,
    }, pctChangeByDivision);
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
        confidence: "medium",
        observed_at: r.observed_at,
        region_code: rc,
      }, pctChangeByDivision);
    }
  }

  // 6) National
  const { data: nat } = await db
    .from("cost_prices")
    .select("*")
    .eq("cost_code_id", codeId)
    .eq("region_type", "national")
    .order("observed_at", { ascending: false })
    .limit(1);
  if (nat && nat.length > 0) {
    const r = nat[0];
    return applyPpiAging({
      cost_code,
      unit_cost: Number(r.unit_cost),
      labor_cost: r.labor_cost ?? undefined,
      material_cost: r.material_cost ?? undefined,
      equipment_cost: r.equipment_cost ?? undefined,
      source: "national_price",
      confidence: "low",
      observed_at: r.observed_at,
      region_code: r.region_code,
    }, pctChangeByDivision);
  }

  return {
    cost_code,
    unit_cost: 0,
    source: "none",
    confidence: "low",
    detail: "no pricing data available",
  };
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
    const metro = region.metro?.trim();
    const state = region.state?.trim();
    const regionCandidates: string[] = [];
    if (zip) regionCandidates.push(zip);
    if (metro) regionCandidates.push(metro);
    if (state) regionCandidates.push(state);

    const codes = [...new Set(group.map((g) => g.cost_code))];

    // Stage 1: resolve all cost_code rows in one query.
    const { data: codeRows } = await db
      .from("cost_codes")
      .select("id, csi_code")
      .in("csi_code", codes);
    const codeIdByCsi = new Map<string, string>(
      (codeRows ?? []).map((r: Row) => [r.csi_code, r.id]),
    );
    const codeIds = [...codeIdByCsi.values()];

    const missingCodes = codes.filter((c) => !codeIdByCsi.has(c));
    for (const c of missingCodes) {
      for (const input of group.filter((g) => g.cost_code === c)) {
        results.set(input, {
          cost_code: c,
          unit_cost: 0,
          source: "none",
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
    if (state) actualsQuery = actualsQuery.eq("region_code", state);
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

    for (const input of group) {
      const { cost_code } = input;
      if (results.has(input)) continue; // already resolved as "unknown cost_code" above
      const codeId = codeIdByCsi.get(cost_code)!;

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
          confidence: "high",
          observed_at: anyOverride.effective_from,
          region_code: anyOverride.region_code ?? undefined,
        }, pctChangeByDivision));
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
          confidence: n >= 3 ? "high" : "medium",
          detail: `avg of ${n} actuals (last 6mo)`,
          region_code: state,
          observed_at: newest,
        }, pctChangeByDivision));
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
          confidence: "medium",
          observed_at: regional.observed_at,
          region_code: regional.region_code,
        }, pctChangeByDivision));
        continue;
      }

      // Precedence 6: national.
      const nat = nationalByCodeId.get(codeId);
      if (nat) {
        results.set(input, applyPpiAging({
          cost_code,
          unit_cost: Number(nat.unit_cost),
          labor_cost: nat.labor_cost ?? undefined,
          material_cost: nat.material_cost ?? undefined,
          equipment_cost: nat.equipment_cost ?? undefined,
          source: "national_price",
          confidence: "low",
          observed_at: nat.observed_at,
          region_code: nat.region_code,
        }, pctChangeByDivision));
        continue;
      }

      results.set(input, {
        cost_code,
        unit_cost: 0,
        source: "none",
        confidence: "low",
        detail: "no pricing data available",
      });
    }
  }

  return inputs.map((input) => results.get(input)!);
}
