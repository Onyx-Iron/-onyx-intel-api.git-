// Supabase Edge Function: sync-commodity-indexes
// Deno runtime. Invoked monthly by pg_cron (see the scheduling migration).
//
// Ports scripts/fetch_bls_ppi.py's fetch logic to run server-side inside
// Supabase, and extends it into a full escalation engine:
//
//   1. Pull the latest Producer Price Index (PPI) values from the Bureau of
//      Labor Statistics for the four commodity series this catalog tracks.
//   2. Upsert each series' latest value into `commodity_trend_series`.
//   3. Compute each series' ~90-day (3-monthly-period) percent change.
//   4. Any `cost_overrides` catalog row that hasn't been manually touched in
//      90+ days gets its `unit_cost` escalated by its CSI division's matching
//      commodity index delta, and the change is logged to
//      `catalog_pricing_history`.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — standard edge function secrets.
//   BLS_API_KEY (optional) — registered key raises BLS's rate limit from
//     25 series/10yr/day to 500 series/20yr/day. Not required for 4 series.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BLS_API_KEY      = Deno.env.get("BLS_API_KEY");

const BLS_ENDPOINT = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

// The four commodity series this engine escalates against, mapped to the CSI
// MasterFormat division whose catalog items they price-index.
const TRACKED_SERIES: { series_id: string; csi_division: string; description: string }[] = [
  { series_id: "WPU0811",    csi_division: "06", description: "Softwood lumber" },
  { series_id: "WPU1322",    csi_division: "03", description: "Ready-mixed concrete" },
  { series_id: "WPU1017",    csi_division: "05", description: "Iron and steel" },
  { series_id: "WPU10260213", csi_division: "26", description: "Insulated copper wire & cable" },
];

// A stale catalog row is escalated against the same ~90-day window used to
// measure the commodity delta — 3 monthly BLS periods approximates 90 days
// closely enough for a monthly-cadence escalation job.
const STALE_AFTER_DAYS = 90;
const TREND_WINDOW_PERIODS = 3;

interface BlsDataPoint {
  year: string;
  period: string; // "M01".."M12" (monthly); "M13" is an annual average — skip it
  periodName: string;
  value: string;
  footnotes?: { code?: string; text?: string }[];
}

interface BlsSeries {
  seriesID: string;
  data: BlsDataPoint[];
}

interface BlsResponse {
  status: string;
  message?: string[];
  Results?: { series?: BlsSeries[] };
}

async function fetchBlsSeries(seriesIds: string[]): Promise<BlsResponse> {
  const endYear = new Date().getUTCFullYear();
  const body: Record<string, unknown> = {
    seriesid: seriesIds,
    startyear: String(endYear - 1),
    endyear: String(endYear),
  };
  if (BLS_API_KEY) body.registrationkey = BLS_API_KEY;

  const res = await fetch(BLS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`BLS API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  return await res.json();
}

/** BLS returns newest-first; sort chronologically ascending, monthly points only. */
function sortedMonthlyPoints(points: BlsDataPoint[]): BlsDataPoint[] {
  return points
    .filter((p) => /^M(0[1-9]|1[0-2])$/.test(p.period)) // exclude M13 annual average
    .slice()
    .sort((a, b) => {
      const ay = Number(a.year), by = Number(b.year);
      if (ay !== by) return ay - by;
      return Number(a.period.slice(1)) - Number(b.period.slice(1));
    });
}

interface SeriesTrend {
  series_id: string;
  csi_division: string;
  last_value: number;
  pct_change_90d: number | null;
}

Deno.serve(async (_req) => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // ── 1. Fetch BLS PPI series ──────────────────────────────────────────────
    const raw = await fetchBlsSeries(TRACKED_SERIES.map((s) => s.series_id));
    if (raw.status !== "REQUEST_SUCCEEDED") {
      throw new Error(`BLS request failed: ${(raw.message ?? []).join("; ") || raw.status}`);
    }
    const seriesById = new Map((raw.Results?.series ?? []).map((s) => [s.seriesID, s]));

    // ── 2 & 3. Compute latest value + 90-day delta per series ───────────────
    const trends: SeriesTrend[] = [];
    for (const meta of TRACKED_SERIES) {
      const series = seriesById.get(meta.series_id);
      const points = sortedMonthlyPoints(series?.data ?? []);
      if (points.length === 0) {
        console.warn(`[sync-commodity-indexes] no data points for ${meta.series_id}`);
        continue;
      }
      const latest = points[points.length - 1];
      const lastValue = Number(latest.value);

      let pctChange: number | null = null;
      const priorIdx = points.length - 1 - TREND_WINDOW_PERIODS;
      if (priorIdx >= 0) {
        const priorValue = Number(points[priorIdx].value);
        if (priorValue !== 0) {
          pctChange = ((lastValue - priorValue) / priorValue) * 100;
        }
      }

      trends.push({
        series_id: meta.series_id,
        csi_division: meta.csi_division,
        last_value: lastValue,
        pct_change_90d: pctChange,
      });
    }

    // ── Upsert commodity_trend_series ────────────────────────────────────────
    if (trends.length > 0) {
      const { error: upsertErr } = await db.from("commodity_trend_series").upsert(
        trends.map((t) => ({
          series_id: t.series_id,
          csi_division: t.csi_division,
          last_value: t.last_value,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "series_id" },
      );
      if (upsertErr) throw new Error(`commodity_trend_series upsert: ${upsertErr.message}`);
    }

    // ── 4. Escalate stale catalog items ──────────────────────────────────────
    const deltaByDivision = new Map(
      trends.filter((t) => t.pct_change_90d !== null).map((t) => [t.csi_division, t.pct_change_90d as number]),
    );

    const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleRows, error: staleErr } = await db
      .from("cost_overrides")
      .select("id, tenant_id, unit_cost, updated_at, cost_code_id, cost_codes(division)")
      .lt("updated_at", staleCutoff);
    if (staleErr) throw new Error(`stale catalog lookup: ${staleErr.message}`);

    let escalated = 0;
    const historyRows: Record<string, unknown>[] = [];
    const priceUpdates: { id: string; unit_cost: number }[] = [];

    for (const row of (staleRows ?? []) as any[]) {
      const division = row.cost_codes?.division as string | undefined;
      if (!division) continue;
      const delta = deltaByDivision.get(division);
      if (delta == null || delta === 0) continue; // no matching signal, or no movement

      const oldPrice = Number(row.unit_cost);
      if (!Number.isFinite(oldPrice) || oldPrice <= 0) continue;
      const newPrice = Math.round(oldPrice * (1 + delta / 100) * 100) / 100;
      if (newPrice === oldPrice) continue;

      priceUpdates.push({ id: row.id, unit_cost: newPrice });
      historyRows.push({
        catalog_id: row.id,
        tenant_id: row.tenant_id,
        old_price: oldPrice,
        new_price: newPrice,
        applied_index_delta: delta,
        changed_at: new Date().toISOString(),
      });
      escalated++;
    }

    // Each row needs its own UPDATE (unit_cost differs per row) — batch via
    // Promise.all rather than a single upsert to avoid clobbering unrelated
    // columns on `cost_overrides`.
    await Promise.all(
      priceUpdates.map((u) =>
        db.from("cost_overrides")
          .update({ unit_cost: u.unit_cost, updated_at: new Date().toISOString() })
          .eq("id", u.id),
      ),
    );

    if (historyRows.length > 0) {
      const { error: histErr } = await db.from("catalog_pricing_history").insert(historyRows);
      if (histErr) throw new Error(`catalog_pricing_history insert: ${histErr.message}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        series_synced: trends.length,
        trends,
        catalog_items_evaluated: (staleRows ?? []).length,
        catalog_items_escalated: escalated,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[sync-commodity-indexes]", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
