import { createServiceClient } from "@/lib/supabase/server";

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
      return {
        cost_code,
        unit_cost: Number(r.unit_cost),
        labor_cost: r.labor_cost ?? undefined,
        material_cost: r.material_cost ?? undefined,
        equipment_cost: r.equipment_cost ?? undefined,
        source: "tenant_override",
        confidence: "high",
        observed_at: r.effective_from,
        region_code: r.region_code ?? undefined,
      };
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
    return {
      cost_code,
      unit_cost: Number(r.unit_cost),
      labor_cost: r.labor_cost ?? undefined,
      material_cost: r.material_cost ?? undefined,
      equipment_cost: r.equipment_cost ?? undefined,
      source: "tenant_override",
      confidence: "high",
      observed_at: r.effective_from,
    };
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
    return {
      cost_code,
      unit_cost: avg,
      source: "actuals_avg",
      confidence: n >= 3 ? "high" : "medium",
      detail: `avg of ${n} actuals (last 6mo)`,
      region_code: state,
    };
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
      return {
        cost_code,
        unit_cost: Number(r.unit_cost),
        labor_cost: r.labor_cost ?? undefined,
        material_cost: r.material_cost ?? undefined,
        equipment_cost: r.equipment_cost ?? undefined,
        source: "regional_price",
        confidence: "medium",
        observed_at: r.observed_at,
        region_code: rc,
      };
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
    return {
      cost_code,
      unit_cost: Number(r.unit_cost),
      labor_cost: r.labor_cost ?? undefined,
      material_cost: r.material_cost ?? undefined,
      equipment_cost: r.equipment_cost ?? undefined,
      source: "national_price",
      confidence: "low",
      observed_at: r.observed_at,
      region_code: r.region_code,
    };
  }

  return {
    cost_code,
    unit_cost: 0,
    source: "none",
    confidence: "low",
    detail: "no pricing data available",
  };
}
