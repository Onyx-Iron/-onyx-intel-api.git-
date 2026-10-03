"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

// Roles whose view of the pricing matrix is masked: unit cost cells, markup
// sliders, and the assembly-mix pricing action are hidden/disabled, while
// quantities and descriptions (which mirror drawing/field takeoff data) stay
// visible so these roles can still confirm scope.
type RestrictedRole = "FieldSuperintendent" | "ClientView";
const RESTRICTED_ROLES: ReadonlySet<string> = new Set<RestrictedRole>(["FieldSuperintendent", "ClientView"]);

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

/** Fixed row height keeps the virtualizer stable at 60 FPS for 1,000+ line items. */
const ESTIMATE_ROW_HEIGHT_PX = 36;
const ESTIMATE_MATRIX_COL_COUNT = 13;

// Converts an authoritative estimate_items row (cost-category dollar totals)
// into the grid's editable per-unit-rate shape. Division is exact (not
// rounded) so a round-trip load -> save reproduces the same dollar totals.
function itemToRow(it: {
  id: string; cost_code: string | null; description: string | null; quantity: number | null; uom: string | null;
  labor_cost: number; material_cost: number; equipment_cost: number; trucking_cost: number;
  subcontract_cost: number; disposal_cost: number; notes: string | null; sort_order?: number;
}, index: number): EstimateRow {
  const q = it.quantity && it.quantity !== 0 ? it.quantity : 1;
  return {
    id: it.id,
    cost_code: it.cost_code ?? "",
    description: it.description ?? "",
    quantity: it.quantity ?? 0,
    unit: it.uom ?? "EA",
    labor_unit: it.labor_cost / q,
    material_unit: it.material_cost / q,
    equipment_unit: it.equipment_cost / q,
    subcontractor_unit: it.subcontract_cost / q,
    trucking_unit: it.trucking_cost / q,
    disposal_unit: it.disposal_cost / q,
    notes: it.notes ?? "",
    sort_order: it.sort_order ?? index,
    _dirty: false,
  };
}

export default function EstimateMatrix({ projectId, projectName }: Props) {
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [settings, setSettings] = useState<FinancialSettings>({ overhead_pct: 10, profit_pct: 15, contingency_pct: 5 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [versionStatus, setVersionStatus] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ id: string; version_number: number; status: string }[]>([]);
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [versionDiff, setVersionDiff] = useState<{
    added: { description?: string | null; csi_code?: string | null }[];
    removed: { description?: string | null; csi_code?: string | null }[];
    changed: { key: string; quantityDelta: number | null; totalDelta: number | null; right: { description?: string | null } }[];
  } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => ESTIMATE_ROW_HEIGHT_PX,
    overscan: 12,
  });

  const pricingRestricted = role != null && RESTRICTED_ROLES.has(role);
  const locked = versionStatus === "approved" || versionStatus === "superseded" || versionStatus === "void";

  useEffect(() => {
    fetch("/api/project-controls/role", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { role?: string }) => setRole(d.role ?? null))
      .catch(() => setRole(null));
  }, []);

  // ── Initial load — resolves (or creates) the project's one authoritative
  // estimate + its current version, then loads that version's items. ──────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const listRes = await fetch(`/api/estimate/versions?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!listRes.ok) throw new Error(await listRes.text());
      const list = await listRes.json() as { estimate: { id: string; current_version_id: string | null } | null; versions: { id: string; version_number: number; status: string }[] };
      const loadedVersions = list.versions ?? [];
      setVersions(loadedVersions);
      if (loadedVersions.length > 1) {
        setCompareRight((current) => current || loadedVersions[0].id);
        setCompareLeft((current) => current || loadedVersions[1].id);
      }

      let activeVersionId = list.estimate?.current_version_id ?? null;
      if (!activeVersionId) {
        // No estimate exists yet for this project — create Version 1.
        const createRes = await fetch("/api/estimate/versions", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId }),
        });
        if (createRes.ok) {
          const created = await createRes.json() as { version: { id: string } };
          activeVersionId = created.version.id;
        }
      }
      if (!activeVersionId) { setLoading(false); return; }

      const verRes = await fetch(`/api/estimate/versions/${encodeURIComponent(activeVersionId)}`, { cache: "no-store" });
      if (!verRes.ok) throw new Error(await verRes.text());
      const ver = await verRes.json() as {
        version: { id: string; version_number: number; status: string; contingency_pct: number | null; overhead_pct: number | null; profit_pct: number | null };
        items: Parameters<typeof itemToRow>[0][];
      };
      setVersionId(ver.version.id);
      setVersionNumber(ver.version.version_number);
      setVersionStatus(ver.version.status);
      setRows(ver.items.map((it, i) => itemToRow(it, i)));
      setSettings({
        overhead_pct: numericOr(ver.version.overhead_pct, 10),
        profit_pct:   numericOr(ver.version.profit_pct, 15),
        contingency_pct: numericOr(ver.version.contingency_pct, 5),
      });
    } catch (e) {
      console.error("[estimate] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // ── Create a new draft (from the current locked version) and switch to it ──
  async function createNewDraft() {
    if (!versionId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/estimate/versions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_version_id: versionId }),
      });
      if (res.ok) await load();
    } finally {
      setSaving(false);
    }
  }

  async function compareVersions() {
    if (!compareLeft || !compareRight || compareLeft === compareRight) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/estimate/versions/diff?left=${encodeURIComponent(compareLeft)}&right=${encodeURIComponent(compareRight)}`, { cache: "no-store" });
      const data = await res.json() as { diff?: typeof versionDiff; error?: string };
      if (!res.ok || !data.diff) {
        setSeedResult(data.error ?? "Compare failed");
        return;
      }
      setVersionDiff(data.diff);
    } finally {
      setSaving(false);
    }
  }

  async function saveBudget() {
    if (!versionId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/estimate/versions/${encodeURIComponent(versionId)}/budget`, { method: "POST" });
      const data = await res.json() as { created?: boolean; budget?: { line_count?: number; total_price?: number }; error?: string };
      if (!res.ok) {
        setSeedResult(data.error ?? "Budget save failed");
        return;
      }
      const count = data.budget?.line_count ?? 0;
      setSeedResult(data.created ? `Budget saved from this approved version (${count} lines).` : `Budget already exists for this version (${count} lines).`);
    } finally {
      setSaving(false);
    }
  }

  async function approveCurrentVersion() {
    if (!versionId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/estimate/versions/${encodeURIComponent(versionId)}/approve`, { method: "POST" });
      if (res.ok) await load();
      else setSeedResult(`Approve failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
    } finally {
      setSaving(false);
    }
  }

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
    if (locked) return; // approved/superseded/void versions are immutable — create a new draft to edit
    if (pricingRestricted) {
      // Belt-and-suspenders: strip unit-cost fields even if a disabled
      // input somehow still fired a change event.
      for (const k of UNIT_COL_KEYS) delete (patch as Record<string, unknown>)[k];
      if (Object.keys(patch).length === 0) return;
    }
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)));
    scheduleAutoSave();
  }

  function addRow() {
    if (locked) return;
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
    if (pricingRestricted || locked) return; // FieldSuperintendent / ClientView can't add priced rows; locked versions can't be edited
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
    if (locked) return; // approved/superseded/void — server would reject anyway; don't even try
    const r = rows[idx];
    if (r.id && versionId) {
      await fetch(`/api/estimate/versions/${encodeURIComponent(versionId)}?item_id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  const scheduleAutoSave = useCallback(() => {
    if (locked) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveAll(); }, 900);
  }, [locked]);

  // Converts a row's edited per-unit rates back into cost-category dollar
  // totals for the authoritative estimate_items shape. contingency/overhead/
  // profit are intentionally omitted — the server derives them from the
  // version's percentages (the sliders below), never trusted from here.
  async function saveAll(includeSettings = true) {
    if (saving || locked || !versionId) return;
    const dirty = rows.filter((r) => r._dirty);
    if (dirty.length === 0 && !includeSettings) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/estimate/versions/${encodeURIComponent(versionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: dirty.map((r, i) => ({
            id: r.id,
            cost_code: r.cost_code || null,
            description: r.description,
            quantity: r.quantity,
            uom: r.unit,
            labor_cost: r.quantity * r.labor_unit,
            material_cost: r.quantity * r.material_unit,
            equipment_cost: r.quantity * r.equipment_unit,
            subcontract_cost: r.quantity * r.subcontractor_unit,
            trucking_cost: r.quantity * r.trucking_unit,
            disposal_cost: r.quantity * r.disposal_unit,
            notes: r.notes,
            sort_order: i,
          })),
          settings: includeSettings ? settings : undefined,
        }),
      });
      if (res.ok) {
        await load(); // reload to pick up server-assigned IDs + recalculated totals
      }
    } finally {
      setSaving(false);
    }
  }

  function updateSetting(key: keyof FinancialSettings, value: number) {
    if (pricingRestricted || locked) return; // markup sliders are locked for these roles / locked versions
    setSettings((s) => ({ ...s, [key]: value }));
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveAll(); }, 400);
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportProposal = useCallback(async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const overheadPct = settings.overhead_pct / 100;
    const profitPct = settings.profit_pct / 100;
    const contingencyPct = settings.contingency_pct / 100;

    // Sheet 1: Client Proposal with live formulas referencing SOV totals
    const proposalRows: (string | number)[][] = [
      [`Proposal · ${projectName}`],
      [new Date().toLocaleDateString()],
      [],
      ["Metric", "Value"],
      ["Direct Cost Total", 0],
      [`Contingency (${settings.contingency_pct}%)`, 0],
      ["Subtotal", 0],
      [`Overhead (${settings.overhead_pct}%)`, 0],
      [`Profit (${settings.profit_pct}%)`, 0],
      ["FINAL BID", 0],
    ];
    const wsProposal = XLSX.utils.aoa_to_sheet(proposalRows);
    // Live formulas (Excel recalculates) — values above are placeholders.
    wsProposal["B5"] = { t: "n", f: "'Schedule of Values'!L" + String(5 + rows.length + 1) };
    wsProposal["B6"] = { t: "n", f: `B5*${contingencyPct}` };
    wsProposal["B7"] = { t: "n", f: "B5+B6" };
    wsProposal["B8"] = { t: "n", f: `B7*${overheadPct}` };
    wsProposal["B9"] = { t: "n", f: `(B7+B8)*${profitPct}` };
    wsProposal["B10"] = { t: "n", f: "B7+B8+B9" };
    wsProposal["!cols"] = [{ wch: 28 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsProposal, "Proposal");

    // Sheet 2: Schedule of Values — unit rates as values, extensions as formulas
    const sovHeader = [
      "Item #", "Cost Code", "Description", "Qty", "Unit",
      "Labor Unit", "Material Unit", "Equipment Unit", "Sub Unit", "Trucking Unit", "Disposal Unit",
      "Direct", "Overhead", "Profit", "SOV Value",
    ];
    const sovAoa: (string | number)[][] = [
      [`Schedule of Values · ${projectName}`],
      [new Date().toLocaleDateString()],
      [],
      sovHeader,
    ];
    rows.forEach((r, i) => {
      sovAoa.push([
        i + 1,
        r.cost_code || "",
        r.description || "",
        r.quantity,
        r.unit,
        r.labor_unit,
        r.material_unit,
        r.equipment_unit,
        r.subcontractor_unit,
        r.trucking_unit,
        r.disposal_unit,
        0, 0, 0, 0, // filled with formulas below
      ]);
    });
    const totalExcelRow = 5 + rows.length; // 1-based; header is row 4, data starts row 5
    sovAoa.push([]);
    sovAoa.push(["", "", "TOTAL", "", "", "", "", "", "", "", "", 0, 0, 0, 0]);

    const wsSov = XLSX.utils.aoa_to_sheet(sovAoa);
    rows.forEach((_, i) => {
      const er = 5 + i; // Excel row
      // Direct = Qty * sum of unit rates
      wsSov[`L${er}`] = { t: "n", f: `D${er}*(F${er}+G${er}+H${er}+I${er}+J${er}+K${er})` };
      wsSov[`M${er}`] = { t: "n", f: `L${er}*${overheadPct}` };
      wsSov[`N${er}`] = { t: "n", f: `(L${er}+M${er})*${profitPct}` };
      wsSov[`O${er}`] = { t: "n", f: `L${er}+M${er}+N${er}` };
    });
    if (rows.length > 0) {
      const first = 5;
      const last = 4 + rows.length;
      wsSov[`L${totalExcelRow}`] = { t: "n", f: `SUM(L${first}:L${last})` };
      wsSov[`M${totalExcelRow}`] = { t: "n", f: `SUM(M${first}:M${last})` };
      wsSov[`N${totalExcelRow}`] = { t: "n", f: `SUM(N${first}:N${last})` };
      wsSov[`O${totalExcelRow}`] = { t: "n", f: `SUM(O${first}:O${last})` };
      // Point proposal direct total at this SUM cell
      wsProposal["B5"] = { t: "n", f: `'Schedule of Values'!L${totalExcelRow}` };
    }
    wsSov["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 36 }, ...Array(12).fill({ wch: 12 })];
    XLSX.utils.book_append_sheet(wb, wsSov, "Schedule of Values");

    XLSX.writeFile(wb, `${projectName.replace(/[^\w-]+/g, "_")}_estimate_${Date.now()}.xlsx`);
  }, [projectName, rows, settings]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#06070A] text-white">
      {/* Sticky top: config bar */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#06070A]/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href={`/dashboard/projects/${projectId}`} className="text-[11px] font-semibold uppercase tracking-widest text-white/50 hover:text-white">← Back</Link>
            <div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/40">
                <span>Estimate · Pricing Matrix</span>
                {versionNumber != null && (
                  <span className={`rounded-full px-2 py-0.5 font-bold ${
                    versionStatus === "approved" ? "bg-[#CCFF00]/20 text-[#CCFF00]" :
                    versionStatus === "superseded" ? "bg-white/10 text-white/50" :
                    versionStatus === "void" ? "bg-red-400/20 text-red-300" :
                    "bg-amber-400/20 text-amber-300"
                  }`}>
                    v{versionNumber} · {versionStatus}
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold">{projectName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {locked ? (
              <>
                {versionStatus === "approved" && (
                  <button type="button" onClick={saveBudget} disabled={saving} className="inline-flex h-9 items-center rounded-full border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-4 text-[11px] font-semibold uppercase tracking-widest text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-40">Save as budget</button>
                )}
                <button type="button" onClick={createNewDraft} disabled={saving} className="inline-flex h-9 items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-4 text-[11px] font-semibold uppercase tracking-widest text-amber-300 hover:bg-amber-400/20 disabled:opacity-40">New Draft to Edit</button>
              </>
            ) : (
              <>
                <button type="button" onClick={seed} disabled={saving} className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white disabled:opacity-40">Load from Takeoffs</button>
                <button type="button" onClick={addRow} className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white">+ Row</button>
                {!pricingRestricted && (
                  <button type="button" onClick={() => setAssemblyModalOpen(true)} className="inline-flex h-9 items-center rounded-full border border-[#00D2FF]/30 bg-[#00D2FF]/10 px-4 text-[11px] font-semibold uppercase tracking-widest text-[#00D2FF] hover:bg-[#00D2FF]/20">Insert Assembly Mix</button>
                )}
                {!pricingRestricted && (versionStatus === "draft" || versionStatus === "review") && (
                  <button type="button" onClick={approveCurrentVersion} disabled={saving} className="inline-flex h-9 items-center rounded-full border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-4 text-[11px] font-semibold uppercase tracking-widest text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-40">Approve Version</button>
                )}
              </>
            )}
            <button type="button" onClick={exportProposal} className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85">Export XLSX</button>
          </div>
        </div>

        {/* Slider row — markup/profit multipliers are masked for field & client roles */}
        <div className="border-t border-white/5 px-4 py-2 grid grid-cols-3 gap-6">
          <SliderControl label="Overhead" value={settings.overhead_pct} onChange={(v) => updateSetting("overhead_pct", v)} tone="text-[#CCFF00]" disabled={pricingRestricted || locked} />
          <SliderControl label="Profit" value={settings.profit_pct} onChange={(v) => updateSetting("profit_pct", v)} tone="text-[#00D2FF]" disabled={pricingRestricted || locked} />
          <SliderControl label="Contingency" value={settings.contingency_pct} onChange={(v) => updateSetting("contingency_pct", v)} tone="text-amber-400" disabled={pricingRestricted || locked} />
        </div>

        {pricingRestricted && (
          <div className="border-t border-white/5 bg-amber-900/10 px-4 py-1.5 text-[11px] text-amber-400/80">
            Pricing and markup controls are hidden for your role ({role}).
          </div>
        )}
        {locked && (
          <div className="border-t border-white/5 bg-white/[0.03] px-4 py-1.5 text-[11px] text-white/50">
            This version is <b>{versionStatus}</b> and cannot be edited. Click <b>New Draft to Edit</b> to make changes — it will copy every item into a fresh draft version.
          </div>
        )}

        {seedResult && <div className="border-t border-white/5 bg-white/[0.03] px-4 py-1.5 text-[11px] text-white/70">{seedResult}</div>}
        {versions.length > 1 && (
          <div className="border-t border-white/5 px-4 py-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="uppercase tracking-widest text-white/40">Compare</span>
            <select value={compareLeft} onChange={(e) => setCompareLeft(e.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white">
              {versions.map((version) => <option key={version.id} value={version.id}>v{version.version_number} {version.status}</option>)}
            </select>
            <span className="text-white/40">to</span>
            <select value={compareRight} onChange={(e) => setCompareRight(e.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white">
              {versions.map((version) => <option key={`right-${version.id}`} value={version.id}>v{version.version_number} {version.status}</option>)}
            </select>
            <button type="button" onClick={compareVersions} disabled={saving || compareLeft === compareRight} className="rounded-full border border-white/15 px-3 py-1 uppercase tracking-widest text-white/70 hover:text-white disabled:opacity-40">Show diff</button>
            {versionDiff && (
              <span className="text-white/70">
                {versionDiff.added.length} added · {versionDiff.removed.length} removed · {versionDiff.changed.length} changed
              </span>
            )}
          </div>
        )}
        {versionDiff && versionDiff.changed.length > 0 && (
          <ul className="border-t border-white/5 px-4 py-2 text-[11px] text-white/60">
            {versionDiff.changed.slice(0, 8).map((change) => (
              <li key={change.key}>
                {change.right.description ?? change.key}
                {change.quantityDelta != null ? ` · qty ${change.quantityDelta > 0 ? "+" : ""}${change.quantityDelta}` : ""}
                {change.totalDelta != null ? ` · total ${change.totalDelta > 0 ? "+" : ""}${change.totalDelta}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Grid — virtualized tbody keeps DOM node count bounded for large estimates */}
      <div ref={gridScrollRef} className="flex-1 overflow-auto">
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
              {(() => {
                const virtualRows = rowVirtualizer.getVirtualItems();
                const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
                const paddingBottom = virtualRows.length > 0
                  ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
                  : 0;
                return (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={ESTIMATE_MATRIX_COL_COUNT} style={{ height: paddingTop, padding: 0, border: 0 }} />
                      </tr>
                    )}
                    {virtualRows.map((virtualRow) => {
                      const i = virtualRow.index;
                      const r = rows[i];
                      const direct = rowDirect(r);
                      return (
                        <tr
                          key={r.id ?? r._local}
                          data-index={virtualRow.index}
                          className={`hover:bg-white/[0.02] ${r._dirty ? "bg-[#CCFF00]/[0.03]" : ""}`}
                          style={{ height: ESTIMATE_ROW_HEIGHT_PX }}
                        >
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
                              {pricingRestricted ? (
                                <span className="block w-full px-1 py-1 text-xs text-right font-mono text-white/20 select-none" aria-hidden="true">••••</span>
                              ) : (
                                <input type="number" step="0.01" value={r[k]} onChange={(e) => updateRow(i, { [k]: Number(e.target.value) } as Partial<EstimateRow>)} className="w-full bg-transparent px-1 py-1 text-xs text-right font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                              )}
                            </td>
                          ))}
                          <td className="border-b border-white/5 px-2 py-1 text-right text-xs font-mono text-white">{pricingRestricted ? "••••" : `$${fmt(direct)}`}</td>
                          <td className="border-b border-white/5 px-1 py-1 text-center">
                            <button type="button" onClick={() => removeRow(i)} className="text-white/30 hover:text-red-400 text-xs">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                    {paddingBottom > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={ESTIMATE_MATRIX_COL_COUNT} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        )}
      </div>

      {/* Totals footer — hidden for masked roles since it exposes markup/profit */}
      <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#0E0F12] px-4 py-3">
        {pricingRestricted ? (
          <div className="text-center text-[11px] uppercase tracking-widest font-mono text-white/30">Pricing totals hidden for your role</div>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
            <Total label="Direct" value={totals.direct} />
            <Total label={`Contingency (${settings.contingency_pct}%)`} value={totals.contingency} tone="text-amber-400" />
            <Total label="Subtotal" value={totals.subtotal} />
            <Total label={`+ Overhead & Profit`} value={totals.finalBid - totals.subtotal} />
            <Total label="FINAL BID" value={totals.finalBid} tone="text-[#CCFF00]" big />
          </div>
        )}
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
function SliderControl({ label, value, onChange, tone, disabled }: { label: string; value: number; onChange: (v: number) => void; tone: string; disabled?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${disabled ? "opacity-30" : ""}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">{label}</span>
        <span className={`text-sm font-mono font-bold ${tone}`}>{disabled ? "•••" : `${value.toFixed(1)}%`}</span>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={0} max={50} step={0.5} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[#CCFF00] disabled:cursor-not-allowed" />
        <input type="number" min={0} max={100} step={0.1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-xs font-mono text-right focus:outline-none focus:border-[#CCFF00] disabled:cursor-not-allowed" />
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
function numericOr(v: unknown, d: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}
