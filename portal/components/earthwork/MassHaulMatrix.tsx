"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PipeRunsPanel, EntrancesPanel, StockpilesPanel, LedgerPanel } from "./CivilScopePanels";

type TabKey = "bulk" | "pipe_runs" | "entrances" | "stockpiles" | "ledger";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Surface {
  id: string;
  surface_type: string;
  name: string | null;
  units: string;
  updated_at: string;
}

interface MaterialBreakdown { bcy: number; lcy: number; ccy: number }

interface Haul {
  cut: MaterialBreakdown;
  fill: MaterialBreakdown;
  net_bcy: number;
  onsite_reuse_bcy: number;
  import_bcy: number;
  export_bcy: number;
  truck_loads_export: number;
  truck_loads_import: number;
}

interface VolumeRow {
  id: string;
  layer_name: string;
  cut_volume_cy: number;
  fill_volume_cy: number;
  net_balance_cy: number;
  shrink_factor: number;
  swell_factor: number;
  deductions: {
    topsoil?: { depth_ft: number };
    over_excavation?: { depth_ft: number };
    select_fill?: { depth_ft: number };
  } | null;
  metadata: {
    grid_size?: number;
    cells_evaluated?: number;
    cells_holes?: number;
    extents_sf?: number;
    method?: string;
    truck_payload_cy?: number;
  } | null;
  updated_at: string;
  haul: Haul;
}

interface Totals {
  cut_bcy: number;
  fill_bcy: number;
  net_bcy: number;
  cut: MaterialBreakdown;
  fill: MaterialBreakdown;
  import_bcy: number;
  export_bcy: number;
  onsite_bcy: number;
  truck_import: number;
  truck_export: number;
  haul: Haul;
}

interface Props { projectId: string; projectName: string }

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function MassHaulMatrix({ projectId, projectName }: Props) {
  const [tab, setTab] = useState<TabKey>("bulk");
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [rows, setRows] = useState<VolumeRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);

  // Compute form
  const [existingId, setExistingId] = useState<string>("");
  const [proposedId, setProposedId] = useState<string>("");
  const [layerName, setLayerName]   = useState<string>("site_bulk");
  const [shrink, setShrink]         = useState<number>(0.85);
  const [swell, setSwell]           = useState<number>(1.15);
  const [truckPayload, setTruckPayload] = useState<number>(12);
  const [topsoilDepth, setTopsoilDepth] = useState<number>(0);
  const [overExDepth, setOverExDepth]   = useState<number>(0);
  const [selectFillDepth, setSelectFillDepth] = useState<number>(0);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, vRes] = await Promise.all([
        fetch(`/api/earthwork/surfaces?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch(`/api/earthwork/volumes?project_id=${encodeURIComponent(projectId)}`,  { cache: "no-store" }),
      ]);
      if (sRes.ok) {
        const data = await sRes.json() as { surfaces: Surface[] };
        setSurfaces(data.surfaces);
        if (!existingId) {
          const ex = data.surfaces.find((s) => s.surface_type === "existing");
          if (ex) setExistingId(ex.id);
        }
        if (!proposedId) {
          const pr = data.surfaces.find((s) => s.surface_type === "proposed");
          if (pr) setProposedId(pr.id);
        }
      }
      if (vRes.ok) {
        const data = await vRes.json() as { items: VolumeRow[]; totals: Totals };
        setRows(data.items);
        setTotals(data.totals);
      }
    } finally { setLoading(false); }
  }, [projectId, existingId, proposedId]);

  useEffect(() => { void load(); }, [load]);

  async function compute() {
    if (!existingId || !proposedId) { setError("Pick both an Existing and Proposed surface first"); return; }
    setError(null);
    setComputing(true);
    try {
      const res = await fetch("/api/earthwork/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          existing_surface_id: existingId,
          proposed_surface_id: proposedId,
          layer_name: layerName || "site_bulk",
          factors: { shrink_factor: shrink, swell_factor: swell },
          truck_payload_cy: truckPayload,
          deductions: {
            topsoil: topsoilDepth > 0 ? { depth_ft: topsoilDepth } : undefined,
            over_excavation: overExDepth > 0 ? { depth_ft: overExDepth, polygons: [] } : undefined,
            select_fill: selectFillDepth > 0 ? { depth_ft: selectFillDepth, polygons: [] } : undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(String(data.error ?? res.status));
        return;
      }
      await load();
    } finally { setComputing(false); }
  }

  const canCompute = existingId && proposedId && !computing;
  const rowsSorted = useMemo(() => [...rows].sort((a, b) => a.layer_name.localeCompare(b.layer_name)), [rows]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#06070A] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/dashboard/projects/${projectId}`} className="text-[11px] font-semibold uppercase tracking-widest text-white/50 hover:text-white">← Back</Link>
            <p className="mt-1 text-[10px] uppercase tracking-widest font-mono text-white/40">Civil · Earthwork</p>
            <h1 className="mt-1 text-2xl font-light tracking-tight">Mass Haul Planning Matrix</h1>
            <p className="mt-0.5 text-xs text-white/40">{projectName}</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-1">
          {([
            { k: "bulk",       label: "Bulk Cut/Fill" },
            { k: "pipe_runs",  label: "Pipe Runs & Embedment" },
            { k: "entrances",  label: "Construction Entrances" },
            { k: "stockpiles", label: "Stockpiles" },
            { k: "ledger",     label: "Import / Export Ledger" },
          ] as { k: TabKey; label: string }[]).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              className={`h-8 rounded-full px-3.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                tab === t.k ? "bg-[#CCFF00] text-black" : "text-white/60 hover:text-white hover:bg-white/[0.06] border border-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab !== "bulk" && (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10">
          {tab === "pipe_runs"  && <PipeRunsPanel projectId={projectId} />}
          {tab === "entrances"  && <EntrancesPanel projectId={projectId} />}
          {tab === "stockpiles" && <StockpilesPanel projectId={projectId} />}
          {tab === "ledger"     && <LedgerPanel projectId={projectId} />}
        </div>
      )}

      {tab === "bulk" && (
      <>
      </>
      )}

      {tab === "bulk" && (<>
      {/* Site-wide summary */}
      <div className="border-b border-white/10 bg-[#0E0F12]/60 px-4 py-4 sm:px-6 lg:px-10">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          <Kpi label="Total Cut (BCY)"       value={totals?.cut.bcy ?? 0}     tone="text-[#CCFF00]" />
          <Kpi label="Total Fill (BCY)"      value={totals?.fill.bcy ?? 0}    tone="text-[#00D2FF]" />
          <Kpi label="Net (BCY)"             value={totals?.net_bcy ?? 0}     tone="text-white"      hint={(totals?.net_bcy ?? 0) > 0 ? "→ Export" : (totals?.net_bcy ?? 0) < 0 ? "→ Import" : "Balanced"} />
          <Kpi label="Import (BCY)"          value={totals?.import_bcy ?? 0}  tone="text-orange-400" />
          <Kpi label="Export (BCY)"          value={totals?.export_bcy ?? 0}  tone="text-amber-400" />
          <Kpi label="On-site Reuse (BCY)"   value={totals?.onsite_bcy ?? 0}  tone="text-emerald-400" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Kpi label="Loose Import (LCY)"    value={totals?.haul.import_bcy ? (totals.haul.import_bcy * 1.15) : 0} tone="text-white/70" />
          <Kpi label="Compacted Fill (CCY)"  value={totals?.fill.ccy ?? 0}                                          tone="text-white/70" />
          <Kpi label="Truck Loads Import"    value={totals?.truck_import ?? 0}                                      tone="text-white/70" hint="@ 12 LCY / load" />
          <Kpi label="Truck Loads Export"    value={totals?.truck_export ?? 0}                                      tone="text-white/70" hint="@ 12 LCY / load" />
        </div>
      </div>

      {/* Compute form */}
      <div className="border-b border-white/10 bg-[#06070A] px-4 py-5 sm:px-6 lg:px-10">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Existing surface</span>
            <select value={existingId} onChange={(e) => setExistingId(e.target.value)} className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-xs">
              <option value="">— pick —</option>
              {surfaces.filter((s) => s.surface_type === "existing").map((s) => (
                <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Proposed surface</span>
            <select value={proposedId} onChange={(e) => setProposedId(e.target.value)} className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-xs">
              <option value="">— pick —</option>
              {surfaces.filter((s) => s.surface_type === "proposed").map((s) => (
                <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Layer name</span>
            <input value={layerName} onChange={(e) => setLayerName(e.target.value)} className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-xs font-mono" />
          </label>
          <NumInput label="Shrink factor" value={shrink} step={0.01} onChange={setShrink} />
          <NumInput label="Swell factor"  value={swell}  step={0.01} onChange={setSwell} />
          <NumInput label="Truck payload (CY)" value={truckPayload} step={1} onChange={setTruckPayload} />
          <NumInput label="Topsoil strip (ft)"          value={topsoilDepth}    step={0.1} onChange={setTopsoilDepth} />
          <NumInput label="Over-excavation (ft)"        value={overExDepth}     step={0.1} onChange={setOverExDepth} />
          <NumInput label="Select-fill lift (ft)"       value={selectFillDepth} step={0.1} onChange={setSelectFillDepth} />
          <div className="md:col-span-1 flex items-end">
            <button
              type="button"
              onClick={compute}
              disabled={!canCompute}
              className="w-full inline-flex h-9 items-center justify-center rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40"
            >
              {computing ? "Computing…" : "Run Cut/Fill"}
            </button>
          </div>
        </div>
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      </div>

      {/* Per-layer matrix */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
        {loading ? (
          <div className="p-10 text-center text-sm text-white/40">Loading…</div>
        ) : rowsSorted.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
            <p className="text-sm text-white/60">
              No earthwork volumes yet. Pick an Existing and Proposed surface above, then Run Cut/Fill.
            </p>
            <p className="mt-2 text-xs text-white/40">
              Surfaces are stored in <span className="font-mono">civil_surfaces</span> with a JSON <span className="font-mono">coordinate_mesh</span> —
              typically imported from Civil 3D / LandXML.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[1100px] border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-widest font-mono text-white/40">
                <th className="border-b border-white/10 px-2 py-2">Layer</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Cut BCY</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Fill BCY</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Net BCY</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Loose Import LCY</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Fill CCY</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Import</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Export</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Trucks in / out</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">Shrink / Swell</th>
              </tr>
            </thead>
            <tbody>
              {rowsSorted.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.02]">
                  <td className="border-b border-white/5 px-2 py-2 font-mono text-xs">{r.layer_name}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-[#CCFF00]">{fmt(r.haul.cut.bcy)}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-[#00D2FF]">{fmt(r.haul.fill.bcy)}</td>
                  <td className={`border-b border-white/5 px-2 py-2 text-right font-mono text-xs ${r.haul.net_bcy >= 0 ? "text-amber-400" : "text-orange-400"}`}>
                    {fmt(r.haul.net_bcy)}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-white/70">{fmt(r.haul.import_bcy * r.swell_factor)}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-white/70">{fmt(r.haul.fill.ccy)}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-orange-400">{fmt(r.haul.import_bcy)}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-amber-400">{fmt(r.haul.export_bcy)}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-white/70">
                    {r.haul.truck_loads_import} / {r.haul.truck_loads_export}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-mono text-xs text-white/40">
                    {Number(r.shrink_factor).toFixed(2)} / {Number(r.swell_factor).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>)}
    </div>
  );
}

// ─── UI atoms ────────────────────────────────────────────────────────────────
function Kpi({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[9px] uppercase tracking-widest font-mono text-white/40">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone}`}>{fmt(value)}</div>
      {hint && <div className="mt-0.5 text-[9px] uppercase tracking-widest font-mono text-white/40">{hint}</div>}
    </div>
  );
}
function NumInput({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-right font-mono focus:outline-none focus:border-[#CCFF00]" />
    </label>
  );
}
function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
