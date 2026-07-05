"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { calculateAssemblyQuantities, type RebarSize, REBAR_UNIT_WEIGHT_LBS_PER_FT } from "@/lib/math/assemblies";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface EstimateRow {
  id?: string;
  cost_code: string;
  description: string;
  quantity: number;
  unit: string;
  labor_unit: number;
  material_unit: number;
  equipment_unit: number;
  subcontractor_unit: number;
  trucking_unit: number;
  disposal_unit: number;
  notes: string;
  sort_order: number;
  _dirty?: boolean;   // client-only: pending save
  _local?: string;    // client-only: local uuid for un-saved rows
}

interface AssemblyMixInput {
  lengthFt: number;
  widthFt: number;
  thicknessInches: number;
  mixDesign: string;
  wasteMultiplier: number;
  baseDepthInches: number;
  rebarSize: RebarSize;
  rebarSpacingInches: number;
}

interface FinancialSettings {
  overhead_pct: number;
  profit_pct: number;
  contingency_pct: number;
}

interface Props {
  projectId: string;
  projectName: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
const UNIT_COL_KEYS = ["labor_unit", "material_unit", "equipment_unit", "subcontractor_unit", "trucking_unit", "disposal_unit"] as const;
type UnitKey = typeof UNIT_COL_KEYS[number];

const UNIT_COL_LABELS: Record<UnitKey, string> = {
  labor_unit:         "Labor $/u",
  material_unit:      "Mat'l $/u",
  equipment_unit:     "Equip $/u",
  subcontractor_unit: "Sub $/u",
  trucking_unit:      "Truck $/u",
  disposal_unit:      "Disposal $/u",
};

export default function EstimateMatrix({ projectId, projectName }: Props) {
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [settings, setSettings] = useState<FinancialSettings>({ overhead_pct: 10, profit_pct: 15, contingency_pct: 5 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/estimate/matrix?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { rows: EstimateRow[]; settings: FinancialSettings };
      setRows(data.rows.map((r) => ({ ...r, _dirty: false })));
      setSettings({
        overhead_pct: numericOr(data.settings.overhead_pct, 10),
        profit_pct:   numericOr(data.settings.profit_pct, 15),
        contingency_pct: numericOr(data.settings.contingency_pct, 5),
      });
    } catch (e) {
      console.error("[estimate] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // ── Seed from takeoffs / manual ───────────────────────────────────────────
  async function seed() {
    setSaving(true);
    try {
      const res = await fetch("/api/estimate/matrix/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await res.json() as { added?: number; skipped?: number; error?: string };
      if (res.ok) {
        setSeedResult(`Loaded ${data.added ?? 0} new item${data.added === 1 ? "" : "s"} (skipped ${data.skipped ?? 0})`);
        await load();
      } else {
        setSeedResult(`Seed failed: ${data.error ?? res.status}`);
      }
      setTimeout(() => setSeedResult(null), 4000);
    } finally {
      setSaving(false);
    }
  }

  // ── Live math ─────────────────────────────────────────────────────────────
  const rowDirect = useCallback((r: EstimateRow): number => {
    const unitSum =
      r.labor_unit + r.material_unit + r.equipment_unit +
      r.subcontractor_unit + r.trucking_unit + r.disposal_unit;
    return r.quantity * unitSum;
  }, []);

  const totals = useMemo(() => {
    const direct = rows.reduce((s, r) => s + rowDirect(r), 0);
    const contingency = direct * (settings.contingency_pct / 100);
    const subtotal = direct + contingency;
    const withOverhead = subtotal * (1 + settings.overhead_pct / 100);
    const finalBid = withOverhead * (1 + settings.profit_pct / 100);
    return { direct, contingency, subtotal, withOverhead, finalBid };
  }, [rows, settings, rowDirect]);

  // ── Row edit helpers ──────────────────────────────────────────────────────
  function updateRow(idx: number, patch: Partial<EstimateRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)));
    scheduleAutoSave();
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        _local: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        cost_code: "",
        description: "",
        quantity: 0,
        unit: "EA",
        labor_unit: 0,
        material_unit: 0,
        equipment_unit: 0,
        subcontractor_unit: 0,
        trucking_unit: 0,
        disposal_unit: 0,
        notes: "",
        sort_order: prev.length,
        _dirty: true,
      },
    ]);
  }

  // ── Insert Assembly Mix — expands one composite spec into its nested
  // material resource rows (concrete, aggregate base, rebar) ──
  function insertAssembly(input: AssemblyMixInput) {
    const areaSf = input.lengthFt * input.widthFt;
    const qty = calculateAssemblyQuantities({
      area_sf: areaSf,
      thickness_inches: input.thicknessInches,
      waste_multiplier: input.wasteMultiplier,
      base_depth_inches: input.baseDepthInches,
      rebar_size: input.rebarSize,
      rebar_spacing_inches: input.rebarSpacingInches,
      grid_run_lengths_ft: [input.lengthFt, input.widthFt],
    });

    const newRows: EstimateRow[] = [];
    const nextSort = rows.length;

    if (qty.concrete_cy > 0) {
      newRows.push({
        _local: `asm-concrete-${Date.now()}`,
        cost_code: "03-30-00",
        description: `Concrete — ${input.mixDesign}, ${input.thicknessInches}" thick`,
        quantity: qty.concrete_cy,
        unit: "CY",
        labor_unit: 0, material_unit: 0, equipment_unit: 0,
        subcontractor_unit: 0, trucking_unit: 0, disposal_unit: 0,
        notes: `Assembly mix · ${areaSf.toLocaleString()} SF @ ${input.thicknessInches}"`,
        sort_order: nextSort + newRows.length, _dirty: true,
      });
    }
    if (qty.base_material_tons > 0) {
      newRows.push({
        _local: `asm-base-${Date.now()}`,
        cost_code: "31-23-00",
        description: `Aggregate Subbase — ${input.baseDepthInches}" depth`,
        quantity: qty.base_material_tons,
        unit: "TON",
        labor_unit: 0, material_unit: 0, equipment_unit: 0,
        subcontractor_unit: 0, trucking_unit: 0, disposal_unit: 0,
        notes: `Assembly mix · ${areaSf.toLocaleString()} SF`,
        sort_order: nextSort + newRows.length, _dirty: true,
      });
    }
    if (qty.rebar_lbs > 0) {
      newRows.push({
        _local: `asm-rebar-${Date.now()}`,
        cost_code: "03-20-00",
        description: `Rebar — ${input.rebarSize} @ ${input.rebarSpacingInches}" o.c.`,
        quantity: qty.rebar_lbs,
        unit: "LB",
        labor_unit: 0, material_unit: 0, equipment_unit: 0,
        subcontractor_unit: 0, trucking_unit: 0, disposal_unit: 0,
        notes: `Assembly mix · ${REBAR_UNIT_WEIGHT_LBS_PER_FT[input.rebarSize]} lb/ft unit weight`,
        sort_order: nextSort + newRows.length, _dirty: true,
      });
    }

    setRows((prev) => [...prev, ...newRows]);
    scheduleAutoSave();
    setAssemblyModalOpen(false);
  }

  async function removeRow(idx: number) {
    const r = rows[idx];
    if (r.id) {
      await fetch(`/api/estimate/matrix?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  const scheduleAutoSave = useCallback(() => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveAll(); }, 900);
  }, []);

  async function saveAll(includeSettings = true) {
    if (saving) return;
    const dirty = rows.filter((r) => r._dirty);
    if (dirty.length === 0 && !includeSettings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/estimate/matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          rows: dirty.map((r, i) => ({
            id: r.id,
            cost_code: r.cost_code || null,
            description: r.description,
            quantity: r.quantity,
            unit: r.unit,
            labor_unit: r.labor_unit,
            material_unit: r.material_unit,
            equipment_unit: r.equipment_unit,
            subcontractor_unit: r.subcontractor_unit,
            trucking_unit: r.trucking_unit,
            disposal_unit: r.disposal_unit,
            notes: r.notes,
            sort_order: i,
          })),
          settings: includeSettings ? settings : undefined,
        }),
      });
      if (res.ok) {
        await load(); // reload to pick up server-assigned IDs
      }
    } finally {
      setSaving(false);
    }
  }

  function updateSetting(key: keyof FinancialSettings, value: number) {
    setSettings((s) => ({ ...s, [key]: value }));
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveAll(); }, 400);
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportProposal = useCallback(async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    // Sheet 1: Client Proposal (grouped by cost code prefix)
    const grouped: Record<string, { desc: string; quantity: number; unit: string; direct: number }[]> = {};
    for (const r of rows) {
      const key = r.cost_code || "UNCODED";
      const bucket = grouped[key] ?? (grouped[key] = []);
      bucket.push({ desc: r.description || key, quantity: r.quantity, unit: r.unit, direct: rowDirect(r) });
    }

    const proposalRows: (string | number)[][] = [
      [`Proposal · ${projectName}`],
      [new Date().toLocaleDateString()],
      [],
      ["Cost Code", "Description", "Qty", "Unit", "Direct Cost"],
    ];
    for (const [code, items] of Object.entries(grouped)) {
      const sub = items.reduce((s, i) => s + i.direct, 0);
      for (const it of items) proposalRows.push([code, it.desc, it.quantity, it.unit, round(it.direct)]);
      proposalRows.push(["", `— subtotal ${code} —`, "", "", round(sub)]);
    }
    proposalRows.push([], ["Direct Cost Total", "", "", "", round(totals.direct)]);
    proposalRows.push([`Contingency (${settings.contingency_pct}%)`, "", "", "", round(totals.contingency)]);
    proposalRows.push(["Subtotal", "", "", "", round(totals.subtotal)]);
    proposalRows.push([`Overhead (${settings.overhead_pct}%)`, "", "", "", round(totals.withOverhead - totals.subtotal)]);
    proposalRows.push([`Profit (${settings.profit_pct}%)`, "", "", "", round(totals.finalBid - totals.withOverhead)]);
    proposalRows.push(["FINAL BID", "", "", "", round(totals.finalBid)]);

    const wsProposal = XLSX.utils.aoa_to_sheet(proposalRows);
    wsProposal["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 10 }, { wch: 8 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsProposal, "Proposal");

    // Sheet 2: Schedule of Values
    const sovRows: (string | number)[][] = [
      [`Schedule of Values · ${projectName}`], [new Date().toLocaleDateString()], [],
      ["Item #", "Cost Code", "Description", "Qty", "Unit", "Labor", "Material", "Equipment", "Sub", "Trucking", "Disposal", "Direct", "Overhead", "Profit", "SOV Value"],
    ];
    rows.forEach((r, i) => {
      const direct = rowDirect(r);
      const ovh = direct * (settings.overhead_pct / 100);
      const pft = (direct + ovh) * (settings.profit_pct / 100);
      sovRows.push([
        i + 1, r.cost_code || "", r.description || "", r.quantity, r.unit,
        round(r.quantity * r.labor_unit), round(r.quantity * r.material_unit),
        round(r.quantity * r.equipment_unit), round(r.quantity * r.subcontractor_unit),
        round(r.quantity * r.trucking_unit), round(r.quantity * r.disposal_unit),
        round(direct), round(ovh), round(pft), round(direct + ovh + pft),
      ]);
    });
    sovRows.push([]);
    sovRows.push(["", "", "TOTAL", "", "", "", "", "", "", "", "", round(totals.direct), round(totals.withOverhead - totals.subtotal), round(totals.finalBid - totals.withOverhead), round(totals.finalBid)]);
    const wsSov = XLSX.utils.aoa_to_sheet(sovRows);
    wsSov["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 36 }, ...Array(12).fill({ wch: 12 })];
    XLSX.utils.book_append_sheet(wb, wsSov, "Schedule of Values");

    XLSX.writeFile(wb, `${projectName.replace(/[^\w-]+/g, "_")}_estimate_${Date.now()}.xlsx`);
  }, [projectName, rows, settings, totals, rowDirect]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#06070A] text-white">
      {/* Sticky top: config bar */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#06070A]/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href={`/dashboard/projects/${projectId}`} className="text-[11px] font-semibold uppercase tracking-widest text-white/50 hover:text-white">← Back</Link>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Estimate · Pricing Matrix</div>
              <div className="text-sm font-semibold">{projectName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={seed} disabled={saving} className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white disabled:opacity-40">Load from Takeoffs</button>
            <button type="button" onClick={addRow} className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white">+ Row</button>
            <button type="button" onClick={() => setAssemblyModalOpen(true)} className="inline-flex h-9 items-center rounded-full border border-[#00D2FF]/30 bg-[#00D2FF]/10 px-4 text-[11px] font-semibold uppercase tracking-widest text-[#00D2FF] hover:bg-[#00D2FF]/20">Insert Assembly Mix</button>
            <button type="button" onClick={exportProposal} className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85">Export XLSX</button>
          </div>
        </div>

        {/* Slider row */}
        <div className="border-t border-white/5 px-4 py-2 grid grid-cols-3 gap-6">
          <SliderControl label="Overhead" value={settings.overhead_pct} onChange={(v) => updateSetting("overhead_pct", v)} tone="text-[#CCFF00]" />
          <SliderControl label="Profit" value={settings.profit_pct} onChange={(v) => updateSetting("profit_pct", v)} tone="text-[#00D2FF]" />
          <SliderControl label="Contingency" value={settings.contingency_pct} onChange={(v) => updateSetting("contingency_pct", v)} tone="text-amber-400" />
        </div>

        {seedResult && <div className="border-t border-white/5 bg-white/[0.03] px-4 py-1.5 text-[11px] text-white/70">{seedResult}</div>}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-white/40">Loading estimate…</div>
        ) : rows.length === 0 ? (
          <div className="mx-auto max-w-2xl p-10 text-center">
            <p className="text-sm text-white/60">
              No estimate rows yet. Click <b>Load from Takeoffs</b> to pull items from your takeoff pipeline
              and manual sheet measurements, or <b>+ Row</b> to add one by hand.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[1400px] border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-[#0E0F12]">
              <tr className="text-left text-[9px] uppercase tracking-widest font-mono text-white/40">
                <th className="border-b border-white/10 px-2 py-2 w-10">#</th>
                <th className="border-b border-white/10 px-2 py-2 w-28">Cost Code</th>
                <th className="border-b border-white/10 px-2 py-2 min-w-[260px]">Description</th>
                <th className="border-b border-white/10 px-2 py-2 w-24 text-right">Qty</th>
                <th className="border-b border-white/10 px-2 py-2 w-16">Unit</th>
                {UNIT_COL_KEYS.map((k) => (
                  <th key={k} className="border-b border-white/10 px-2 py-2 w-24 text-right">{UNIT_COL_LABELS[k]}</th>
                ))}
                <th className="border-b border-white/10 px-2 py-2 w-32 text-right text-white/70">Direct</th>
                <th className="border-b border-white/10 px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const direct = rowDirect(r);
                return (
                  <tr key={r.id ?? r._local} className={`hover:bg-white/[0.02] ${r._dirty ? "bg-[#CCFF00]/[0.03]" : ""}`}>
                    <td className="border-b border-white/5 px-2 py-1 text-[10px] font-mono text-white/40">{i + 1}</td>
                    <td className="border-b border-white/5 px-1 py-1">
                      <input value={r.cost_code} onChange={(e) => updateRow(i, { cost_code: e.target.value })} placeholder="NN-NN-NN" className="w-full bg-transparent px-1 py-1 text-[11px] font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                    </td>
                    <td className="border-b border-white/5 px-1 py-1">
                      <input value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} className="w-full bg-transparent px-1 py-1 text-xs focus:outline-none focus:bg-white/[0.05] rounded" />
                    </td>
                    <td className="border-b border-white/5 px-1 py-1">
                      <input type="number" step="0.01" value={r.quantity} onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })} className="w-full bg-transparent px-1 py-1 text-xs text-right font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                    </td>
                    <td className="border-b border-white/5 px-1 py-1">
                      <input value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} className="w-full bg-transparent px-1 py-1 text-[11px] font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                    </td>
                    {UNIT_COL_KEYS.map((k) => (
                      <td key={k} className="border-b border-white/5 px-1 py-1">
                        <input type="number" step="0.01" value={r[k]} onChange={(e) => updateRow(i, { [k]: Number(e.target.value) } as Partial<EstimateRow>)} className="w-full bg-transparent px-1 py-1 text-xs text-right font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                      </td>
                    ))}
                    <td className="border-b border-white/5 px-2 py-1 text-right text-xs font-mono text-white">${fmt(direct)}</td>
                    <td className="border-b border-white/5 px-1 py-1 text-center">
                      <button type="button" onClick={() => removeRow(i)} className="text-white/30 hover:text-red-400 text-xs">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Totals footer */}
      <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#0E0F12] px-4 py-3">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
          <Total label="Direct" value={totals.direct} />
          <Total label={`Contingency (${settings.contingency_pct}%)`} value={totals.contingency} tone="text-amber-400" />
          <Total label="Subtotal" value={totals.subtotal} />
          <Total label={`+ Overhead & Profit`} value={totals.finalBid - totals.subtotal} />
          <Total label="FINAL BID" value={totals.finalBid} tone="text-[#CCFF00]" big />
        </div>
        {saving && <div className="mt-1 text-center text-[10px] uppercase tracking-widest font-mono text-white/40">Saving…</div>}
      </div>

      {assemblyModalOpen && (
        <AssemblyMixModal onClose={() => setAssemblyModalOpen(false)} onInsert={insertAssembly} />
      )}
    </div>
  );
}

// ─── Assembly Mix Modal ─────────────────────────────────────────────────────
const REBAR_SIZES = Object.keys(REBAR_UNIT_WEIGHT_LBS_PER_FT) as RebarSize[];

function AssemblyMixModal({ onClose, onInsert }: { onClose: () => void; onInsert: (input: AssemblyMixInput) => void }) {
  const [lengthFt, setLengthFt] = useState(100);
  const [widthFt, setWidthFt] = useState(20);
  const [thicknessInches, setThicknessInches] = useState(6);
  const [mixDesign, setMixDesign] = useState("4000 PSI");
  const [wasteMultiplier, setWasteMultiplier] = useState(1.05);
  const [baseDepthInches, setBaseDepthInches] = useState(4);
  const [rebarSize, setRebarSize] = useState<RebarSize>("#4");
  const [rebarSpacingInches, setRebarSpacingInches] = useState(18);

  const preview = useMemo(() => calculateAssemblyQuantities({
    area_sf: lengthFt * widthFt,
    thickness_inches: thicknessInches,
    waste_multiplier: wasteMultiplier,
    base_depth_inches: baseDepthInches,
    rebar_size: rebarSize,
    rebar_spacing_inches: rebarSpacingInches,
    grid_run_lengths_ft: [lengthFt, widthFt],
  }), [lengthFt, widthFt, thicknessInches, wasteMultiplier, baseDepthInches, rebarSize, rebarSpacingInches]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0E0F12] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">Insert Assembly Mix</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">✕</button>
        </div>
        <p className="mb-4 text-[11px] text-white/50">
          Composite concrete / paving assembly — expands into concrete, aggregate subbase, and rebar rows.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <ModalField label="Length (ft)"><input type="number" value={lengthFt} onChange={(e) => setLengthFt(Number(e.target.value))} className={inputCls} /></ModalField>
          <ModalField label="Width (ft)"><input type="number" value={widthFt} onChange={(e) => setWidthFt(Number(e.target.value))} className={inputCls} /></ModalField>
          <ModalField label="Thickness (in)"><input type="number" step="0.5" value={thicknessInches} onChange={(e) => setThicknessInches(Number(e.target.value))} className={inputCls} /></ModalField>
          <ModalField label="Mix Design"><input type="text" value={mixDesign} onChange={(e) => setMixDesign(e.target.value)} className={inputCls} /></ModalField>
          <ModalField label="Aggregate Subbase Depth (in)"><input type="number" step="0.5" value={baseDepthInches} onChange={(e) => setBaseDepthInches(Number(e.target.value))} className={inputCls} /></ModalField>
          <ModalField label="Waste Multiplier"><input type="number" step="0.01" value={wasteMultiplier} onChange={(e) => setWasteMultiplier(Number(e.target.value))} className={inputCls} /></ModalField>
          <ModalField label="Rebar Size">
            <select value={rebarSize} onChange={(e) => setRebarSize(e.target.value as RebarSize)} className={inputCls}>
              {REBAR_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </ModalField>
          <ModalField label="Rebar Spacing (in o.c.)"><input type="number" step="1" value={rebarSpacingInches} onChange={(e) => setRebarSpacingInches(Number(e.target.value))} className={inputCls} /></ModalField>
        </div>

        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-white/70">
          <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Preview</div>
          <div className="flex justify-between"><span>Concrete</span><span className="font-mono">{preview.concrete_cy.toLocaleString()} CY</span></div>
          <div className="flex justify-between"><span>Aggregate Subbase</span><span className="font-mono">{preview.base_material_tons.toLocaleString()} TON</span></div>
          <div className="flex justify-between"><span>Rebar</span><span className="font-mono">{preview.rebar_lbs.toLocaleString()} LB</span></div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white">Cancel</button>
          <button
            type="button"
            onClick={() => onInsert({ lengthFt, widthFt, thicknessInches, mixDesign, wasteMultiplier, baseDepthInches, rebarSize, rebarSpacingInches })}
            className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85"
          >
            Insert Rows
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]";

function ModalField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-widest text-white/40">{label}</span>
      {children}
    </label>
  );
}

// ─── Small subcomponents ────────────────────────────────────────────────────
function SliderControl({ label, value, onChange, tone }: { label: string; value: number; onChange: (v: number) => void; tone: string }) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">{label}</span>
        <span className={`text-sm font-mono font-bold ${tone}`}>{value.toFixed(1)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={0} max={50} step={0.5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[#CCFF00]" />
        <input type="number" min={0} max={100} step={0.1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-xs font-mono text-right focus:outline-none focus:border-[#CCFF00]" />
      </div>
    </label>
  );
}

function Total({ label, value, tone, big }: { label: string; value: number; tone?: string; big?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest font-mono text-white/40">{label}</div>
      <div className={`mt-0.5 font-mono ${big ? "text-2xl" : "text-lg"} ${tone ?? "text-white"}`}>${fmt(value)}</div>
    </div>
  );
}

function fmt(v: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
function round(v: number): number { return Math.round(v * 100) / 100; }
function numericOr(v: unknown, d: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}
