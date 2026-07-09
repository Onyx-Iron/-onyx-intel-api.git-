"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n: number, digits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number.isFinite(n) ? n : 0);

function useProjectFetch<T>(projectId: string, url: string): { data: T | null; loading: boolean; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${url}?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [projectId, url]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, refresh };
}

// ═════════════════════════════════════════════════════════════════════════════
// PIPE RUNS PANEL
// ═════════════════════════════════════════════════════════════════════════════
interface PipeRun {
  id: string;
  name: string; system: string; material: string | null;
  diameter_in: number; length_lf: number; avg_depth_ft: number; trench_width_ft: number;
  bedding_depth_in: number; haunch_depth_in: number; initial_backfill_over_pipe_in: number;
  bedding_material: string; backfill_material: string;
  computed: {
    trench_excavation_bcy: number; bedding_cy: number; haunching_cy: number;
    initial_backfill_cy: number; common_backfill_cy: number; pipe_displacement_cy: number;
    spoils_export_bcy: number; bedding_tons: number; haunching_tons: number; initial_backfill_tons: number;
    totals: { aggregate_import_cy: number; aggregate_import_tons: number; backfill_from_native_bcy: number; trench_dewatering_hint_ft: number };
  };
}

export function PipeRunsPanel({ projectId }: { projectId: string }) {
  const { data, refresh } = useProjectFetch<{ runs: PipeRun[] }>(projectId, "/api/earthwork/pipe-runs");
  const runs = data?.runs ?? [];
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    name: "", system: "sanitary", diameter_in: 8, length_lf: 100,
    avg_depth_ft: 6, trench_width_ft: 3, bedding_depth_in: 6, haunch_depth_in: 6, initial_backfill_over_pipe_in: 12,
  });

  const totals = useMemo(() => {
    return runs.reduce((acc, r) => {
      acc.trench_bcy      += r.computed.trench_excavation_bcy;
      acc.bedding_cy      += r.computed.bedding_cy;
      acc.haunching_cy    += r.computed.haunching_cy;
      acc.initial_cy      += r.computed.initial_backfill_cy;
      acc.common_cy       += r.computed.common_backfill_cy;
      acc.spoils_bcy      += r.computed.spoils_export_bcy;
      acc.import_cy       += r.computed.totals.aggregate_import_cy;
      acc.import_tons     += r.computed.totals.aggregate_import_tons;
      acc.lf              += r.length_lf;
      return acc;
    }, { trench_bcy: 0, bedding_cy: 0, haunching_cy: 0, initial_cy: 0, common_cy: 0, spoils_bcy: 0, import_cy: 0, import_tons: 0, lf: 0 });
  }, [runs]);

  async function add() {
    if (!draft.name) return;
    setBusy(true);
    try {
      await fetch("/api/earthwork/pipe-runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ...draft }),
      });
      await refresh();
      setDraft({ ...draft, name: "" });
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    await fetch(`/api/earthwork/pipe-runs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      {/* Totals band */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Total LF"           value={fmt(totals.lf)}                    tone="text-white" />
        <Kpi label="Trench Excav BCY"   value={fmt(totals.trench_bcy)}            tone="text-[#CCFF00]" />
        <Kpi label="Bedding CY"         value={fmt(totals.bedding_cy)}            tone="text-cyan-400" />
        <Kpi label="Haunching CY"       value={fmt(totals.haunching_cy)}          tone="text-cyan-400" />
        <Kpi label="Initial Backfill CY" value={fmt(totals.initial_cy)}           tone="text-cyan-400" />
        <Kpi label="Aggregate Import CY" value={fmt(totals.import_cy)}            tone="text-amber-400" hint={`${fmt(totals.import_tons)} tons`} />
        <Kpi label="Native Backfill CY" value={fmt(totals.common_cy)}             tone="text-emerald-400" />
        <Kpi label="Spoils Export BCY"  value={fmt(totals.spoils_bcy)}            tone="text-orange-400" />
      </div>

      {/* Add-run form */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 grid grid-cols-2 gap-2 md:grid-cols-6 lg:grid-cols-9">
        <TextInput label="Run name"      value={draft.name}                onChange={(v) => setDraft({ ...draft, name: v })} />
        <Select    label="System"        value={draft.system}              onChange={(v) => setDraft({ ...draft, system: v })}
                   options={["sanitary","storm","water","force_main","electrical","comm"]} />
        <NumInput  label="Dia (in)"      value={draft.diameter_in}         step={1}   onChange={(v) => setDraft({ ...draft, diameter_in: v })} />
        <NumInput  label="Length (LF)"   value={draft.length_lf}           step={1}   onChange={(v) => setDraft({ ...draft, length_lf: v })} />
        <NumInput  label="Avg cover (ft)" value={draft.avg_depth_ft}       step={0.5} onChange={(v) => setDraft({ ...draft, avg_depth_ft: v })} />
        <NumInput  label="Trench W (ft)" value={draft.trench_width_ft}     step={0.5} onChange={(v) => setDraft({ ...draft, trench_width_ft: v })} />
        <NumInput  label="Bed (in)"      value={draft.bedding_depth_in}    step={1}   onChange={(v) => setDraft({ ...draft, bedding_depth_in: v })} />
        <NumInput  label="Haunch (in)"   value={draft.haunch_depth_in}     step={1}   onChange={(v) => setDraft({ ...draft, haunch_depth_in: v })} />
        <NumInput  label="Initial (in)"  value={draft.initial_backfill_over_pipe_in} step={1} onChange={(v) => setDraft({ ...draft, initial_backfill_over_pipe_in: v })} />
        <div className="md:col-span-6 lg:col-span-9 flex justify-end">
          <button onClick={add} disabled={busy || !draft.name} className="rounded-full bg-[#CCFF00] px-5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40">
            {busy ? "…" : "Add Pipe Run"}
          </button>
        </div>
      </div>

      {/* Runs table */}
      <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-widest font-mono text-white/40">
            <Th>Name</Th><Th>System</Th><Th>Dia</Th><Th>LF</Th><Th>Cover</Th><Th>W</Th>
            <Th right>Trench BCY</Th><Th right>Bed CY</Th><Th right>Haunch CY</Th><Th right>Init CY</Th>
            <Th right>Import CY</Th><Th right>Spoils</Th><Th></Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-white/[0.02]">
              <Td>{r.name}</Td>
              <Td className="font-mono uppercase text-[10px] text-white/60">{r.system}</Td>
              <Td className="font-mono">{r.diameter_in}&quot;</Td>
              <Td className="font-mono">{fmt(r.length_lf)}</Td>
              <Td className="font-mono">{r.avg_depth_ft}&#39;</Td>
              <Td className="font-mono">{r.trench_width_ft}&#39;</Td>
              <Td right className="font-mono text-[#CCFF00]">{fmt(r.computed.trench_excavation_bcy)}</Td>
              <Td right className="font-mono text-cyan-400">{fmt(r.computed.bedding_cy)}</Td>
              <Td right className="font-mono text-cyan-400">{fmt(r.computed.haunching_cy)}</Td>
              <Td right className="font-mono text-cyan-400">{fmt(r.computed.initial_backfill_cy)}</Td>
              <Td right className="font-mono text-amber-400">{fmt(r.computed.totals.aggregate_import_cy)}</Td>
              <Td right className="font-mono text-orange-400">{fmt(r.computed.spoils_export_bcy)}</Td>
              <Td><button onClick={() => remove(r.id)} className="text-white/30 hover:text-red-400">✕</button></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTRANCES PANEL
// ═════════════════════════════════════════════════════════════════════════════
interface Entrance {
  id: string; name: string;
  length_ft: number; width_ft: number; depth_in: number;
  stone_size: string; fabric_underlayment: boolean;
  computed: { stone_cy: number; stone_tons: number; fabric_sy: number; area_sf: number };
}

export function EntrancesPanel({ projectId }: { projectId: string }) {
  const { data, refresh } = useProjectFetch<{ entrances: Entrance[] }>(projectId, "/api/earthwork/entrances");
  const list = data?.entrances ?? [];
  const [draft, setDraft] = useState({ name: "", length_ft: 50, width_ft: 20, depth_in: 8, fabric_underlayment: true });
  const [busy, setBusy] = useState(false);
  const totals = useMemo(() => list.reduce((a, e) => ({
    stone_cy: a.stone_cy + e.computed.stone_cy,
    stone_tons: a.stone_tons + e.computed.stone_tons,
    fabric_sy: a.fabric_sy + e.computed.fabric_sy,
    area_sf: a.area_sf + e.computed.area_sf,
  }), { stone_cy: 0, stone_tons: 0, fabric_sy: 0, area_sf: 0 }), [list]);

  async function add() {
    if (!draft.name) return;
    setBusy(true);
    try {
      await fetch("/api/earthwork/entrances", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ...draft }),
      });
      await refresh();
      setDraft({ ...draft, name: "" });
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    await fetch(`/api/earthwork/entrances?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Entrances"        value={fmt(list.length)}      tone="text-white" />
        <Kpi label="Stone CY"         value={fmt(totals.stone_cy)}  tone="text-[#CCFF00]" hint={`${fmt(totals.stone_tons)} tons`} />
        <Kpi label="Fabric SY"        value={fmt(totals.fabric_sy)} tone="text-cyan-400" />
        <Kpi label="Footprint SF"     value={fmt(totals.area_sf)}   tone="text-white/70" />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        <TextInput label="Name"       value={draft.name}      onChange={(v) => setDraft({ ...draft, name: v })} />
        <NumInput  label="Length (ft)" value={draft.length_ft} step={5}   onChange={(v) => setDraft({ ...draft, length_ft: v })} />
        <NumInput  label="Width (ft)" value={draft.width_ft}  step={5}   onChange={(v) => setDraft({ ...draft, width_ft: v })} />
        <NumInput  label="Depth (in)" value={draft.depth_in}  step={1}   onChange={(v) => setDraft({ ...draft, depth_in: v })} />
        <label className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Fabric</span>
          <button type="button"
            onClick={() => setDraft({ ...draft, fabric_underlayment: !draft.fabric_underlayment })}
            className={`h-9 rounded-md border px-2 text-xs ${draft.fabric_underlayment ? "border-[#CCFF00]/40 bg-[#CCFF00]/10 text-[#CCFF00]" : "border-white/10 bg-black/40 text-white/60"}`}>
            {draft.fabric_underlayment ? "Yes" : "No"}
          </button>
        </label>
        <div className="flex items-end">
          <button onClick={add} disabled={busy || !draft.name} className="w-full rounded-full bg-[#CCFF00] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40">
            Add
          </button>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead><tr className="text-left text-[9px] uppercase tracking-widest font-mono text-white/40">
          <Th>Name</Th><Th>L × W × D</Th><Th right>Stone CY</Th><Th right>Stone Tons</Th><Th right>Fabric SY</Th><Th right>Footprint SF</Th><Th></Th>
        </tr></thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id} className="hover:bg-white/[0.02]">
              <Td>{e.name}</Td>
              <Td className="font-mono">{e.length_ft} × {e.width_ft} × {e.depth_in}&quot;</Td>
              <Td right className="font-mono text-[#CCFF00]">{fmt(e.computed.stone_cy)}</Td>
              <Td right className="font-mono text-amber-400">{fmt(e.computed.stone_tons)}</Td>
              <Td right className="font-mono text-cyan-400">{fmt(e.computed.fabric_sy)}</Td>
              <Td right className="font-mono text-white/60">{fmt(e.computed.area_sf)}</Td>
              <Td><button onClick={() => remove(e.id)} className="text-white/30 hover:text-red-400">✕</button></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STOCKPILES PANEL
// ═════════════════════════════════════════════════════════════════════════════
interface Stockpile {
  id: string; name: string; material_type: string;
  volume_bcy: number; swell_factor: number;
  location_notes: string | null; reuse_planned: boolean;
  computed: { bcy: number; lcy: number; ccy: number; area_est_sf: number };
}

export function StockpilesPanel({ projectId }: { projectId: string }) {
  const { data, refresh } = useProjectFetch<{ stockpiles: Stockpile[] }>(projectId, "/api/earthwork/stockpiles");
  const list = data?.stockpiles ?? [];
  const [draft, setDraft] = useState({ name: "", material_type: "topsoil", volume_bcy: 0, swell_factor: 1.15, location_notes: "", reuse_planned: true });
  const [busy, setBusy] = useState(false);
  const totals = useMemo(() => list.reduce((a, s) => ({
    bcy: a.bcy + s.computed.bcy, lcy: a.lcy + s.computed.lcy, area: a.area + s.computed.area_est_sf,
  }), { bcy: 0, lcy: 0, area: 0 }), [list]);

  async function add() {
    if (!draft.name || !draft.material_type) return;
    setBusy(true);
    try {
      await fetch("/api/earthwork/stockpiles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ...draft }),
      });
      await refresh();
      setDraft({ ...draft, name: "", volume_bcy: 0 });
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    await fetch(`/api/earthwork/stockpiles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Stockpiles"          value={fmt(list.length)}   tone="text-white" />
        <Kpi label="Total Bank CY"       value={fmt(totals.bcy)}    tone="text-[#CCFF00]" />
        <Kpi label="Total Loose CY"      value={fmt(totals.lcy)}    tone="text-cyan-400" />
        <Kpi label="Est. Footprint SF"   value={fmt(totals.area)}   tone="text-white/70" hint="@ 8 ft avg height" />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        <TextInput label="Name"    value={draft.name}          onChange={(v) => setDraft({ ...draft, name: v })} />
        <Select    label="Material" value={draft.material_type} onChange={(v) => setDraft({ ...draft, material_type: v })}
                   options={["topsoil","native_suitable","rock","recycled_concrete","crushed_agg","spoils"]} />
        <NumInput  label="Volume (BCY)" value={draft.volume_bcy} step={10}  onChange={(v) => setDraft({ ...draft, volume_bcy: v })} />
        <NumInput  label="Swell"        value={draft.swell_factor} step={0.01} onChange={(v) => setDraft({ ...draft, swell_factor: v })} />
        <TextInput label="Location note" value={draft.location_notes} onChange={(v) => setDraft({ ...draft, location_notes: v })} />
        <div className="flex items-end">
          <button onClick={add} disabled={busy || !draft.name} className="w-full rounded-full bg-[#CCFF00] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40">
            Add
          </button>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead><tr className="text-left text-[9px] uppercase tracking-widest font-mono text-white/40">
          <Th>Name</Th><Th>Material</Th><Th right>BCY</Th><Th right>LCY</Th><Th right>CCY</Th><Th right>Footprint SF</Th><Th>Reuse</Th><Th></Th>
        </tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className="hover:bg-white/[0.02]">
              <Td>{s.name}</Td>
              <Td className="font-mono text-[10px] uppercase text-white/60">{s.material_type}</Td>
              <Td right className="font-mono text-[#CCFF00]">{fmt(s.computed.bcy)}</Td>
              <Td right className="font-mono text-cyan-400">{fmt(s.computed.lcy)}</Td>
              <Td right className="font-mono text-white/70">{fmt(s.computed.ccy)}</Td>
              <Td right className="font-mono text-white/60">{fmt(s.computed.area_est_sf)}</Td>
              <Td className="text-[10px]">{s.reuse_planned ? <span className="text-emerald-400">on-site</span> : <span className="text-amber-400">off-haul</span>}</Td>
              <Td><button onClick={() => remove(s.id)} className="text-white/30 hover:text-red-400">✕</button></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LEDGER PANEL
// ═════════════════════════════════════════════════════════════════════════════
interface LedgerRow {
  id: string; direction: "import" | "export" | "stockpile_in" | "stockpile_out";
  material_type: string; quantity_bcy: number | null; quantity_ton: number | null;
  unit_price: number | null; unit_of_measure: string; source_destination: string | null;
  haul_distance_mi: number | null; notes: string | null;
}
interface LedgerTotals {
  import_bcy: number; export_bcy: number; stockpile_bcy: number;
  by_material: Record<string, { import_bcy: number; export_bcy: number }>;
  estimated_cost: number; ton_miles: number;
}

export function LedgerPanel({ projectId }: { projectId: string }) {
  const { data, refresh } = useProjectFetch<{ rows: LedgerRow[]; totals: LedgerTotals }>(projectId, "/api/earthwork/ledger");
  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const [draft, setDraft] = useState<{ direction: LedgerRow["direction"]; material_type: string; quantity_bcy: number; quantity_ton: number; unit_price: number; unit_of_measure: string; source_destination: string; haul_distance_mi: number }>({
    direction: "import", material_type: "select_fill",
    quantity_bcy: 0, quantity_ton: 0, unit_price: 0, unit_of_measure: "CY", source_destination: "", haul_distance_mi: 0,
  });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!draft.material_type) return;
    setBusy(true);
    try {
      await fetch("/api/earthwork/ledger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ...draft }),
      });
      await refresh();
      setDraft({ ...draft, quantity_bcy: 0, quantity_ton: 0 });
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    await fetch(`/api/earthwork/ledger?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Total Import BCY"  value={fmt(totals.import_bcy)}     tone="text-amber-400" />
          <Kpi label="Total Export BCY"  value={fmt(totals.export_bcy)}     tone="text-orange-400" />
          <Kpi label="Net Stockpile BCY" value={fmt(totals.stockpile_bcy)}  tone="text-white/70" />
          <Kpi label="Est. Material Cost" value={"$" + fmt(totals.estimated_cost)} tone="text-[#CCFF00]" />
          <Kpi label="Ton · Miles"        value={fmt(totals.ton_miles)}       tone="text-cyan-400" />
        </div>
      )}

      {totals && Object.keys(totals.by_material).length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-2">By material</div>
          <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
            {Object.entries(totals.by_material).map(([mat, m]) => (
              <div key={mat} className="rounded border border-white/5 bg-black/40 px-2 py-1 text-[11px]">
                <div className="font-mono text-white/60 uppercase text-[9px]">{mat}</div>
                <div className="mt-0.5">Import <span className="font-mono text-amber-400">{fmt(m.import_bcy)}</span></div>
                <div>Export <span className="font-mono text-orange-400">{fmt(m.export_bcy)}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 grid grid-cols-2 gap-2 md:grid-cols-8">
        <Select    label="Direction" value={draft.direction} onChange={(v) => setDraft({ ...draft, direction: v as LedgerRow["direction"] })}
                   options={["import","export","stockpile_in","stockpile_out"]} />
        <Select    label="Material"  value={draft.material_type} onChange={(v) => setDraft({ ...draft, material_type: v })}
                   options={["select_fill","topsoil","spoils","rock","asphalt_millings","crushed_stone","screened_sand"]} />
        <NumInput  label="Qty BCY"   value={draft.quantity_bcy} step={1}   onChange={(v) => setDraft({ ...draft, quantity_bcy: v })} />
        <NumInput  label="Qty Ton"   value={draft.quantity_ton} step={1}   onChange={(v) => setDraft({ ...draft, quantity_ton: v })} />
        <NumInput  label="Unit $"    value={draft.unit_price}   step={0.5} onChange={(v) => setDraft({ ...draft, unit_price: v })} />
        <TextInput label="Source / dest" value={draft.source_destination} onChange={(v) => setDraft({ ...draft, source_destination: v })} />
        <NumInput  label="Haul (mi)" value={draft.haul_distance_mi} step={1} onChange={(v) => setDraft({ ...draft, haul_distance_mi: v })} />
        <div className="flex items-end">
          <button onClick={add} disabled={busy} className="w-full rounded-full bg-[#CCFF00] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40">
            Log
          </button>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead><tr className="text-left text-[9px] uppercase tracking-widest font-mono text-white/40">
          <Th>Dir</Th><Th>Material</Th><Th right>BCY</Th><Th right>Tons</Th><Th right>Unit $</Th>
          <Th>Source / dest</Th><Th right>Haul mi</Th><Th></Th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const dirTone = r.direction === "import" ? "text-amber-400" : r.direction === "export" ? "text-orange-400" : "text-white/50";
            return (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <Td className={`font-mono uppercase text-[10px] ${dirTone}`}>{r.direction}</Td>
                <Td className="font-mono text-[10px] uppercase text-white/60">{r.material_type}</Td>
                <Td right className="font-mono">{r.quantity_bcy != null ? fmt(Number(r.quantity_bcy)) : "—"}</Td>
                <Td right className="font-mono">{r.quantity_ton != null ? fmt(Number(r.quantity_ton)) : "—"}</Td>
                <Td right className="font-mono">{r.unit_price != null ? "$" + fmt(Number(r.unit_price), 2) : "—"}</Td>
                <Td className="text-white/70 truncate max-w-[220px]">{r.source_destination}</Td>
                <Td right className="font-mono">{r.haul_distance_mi != null ? fmt(Number(r.haul_distance_mi)) : "—"}</Td>
                <Td><button onClick={() => remove(r.id)} className="text-white/30 hover:text-red-400">✕</button></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Shared UI atoms
// ═════════════════════════════════════════════════════════════════════════════
function Kpi({ label, value, tone, hint }: { label: string; value: string; tone: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[9px] uppercase tracking-widest font-mono text-white/40">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[9px] uppercase tracking-widest font-mono text-white/40">{hint}</div>}
    </div>
  );
}
function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-xs focus:outline-none focus:border-[#CCFF00]" />
    </label>
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
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-xs">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`border-b border-white/10 px-2 py-2 ${right ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`border-b border-white/5 px-2 py-1.5 ${right ? "text-right" : ""} ${className ?? ""}`}>{children}</td>;
}
