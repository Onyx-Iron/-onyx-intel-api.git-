"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { calculateAssemblyQuantities, type RebarSize, REBAR_UNIT_WEIGHT_LBS_PER_FT } from "@/lib/math/assemblies";
import { applyVersionPercentages, calculateEstimateTotals, calculateItem } from "@/lib/estimating/calculations";
import { ESTIMATE_LINE_TYPES, listCsiSections, lookupCsi, normalizeLineType } from "@/lib/estimating/csi-catalog";
import { quantitySourceLabel } from "@/lib/estimating/estimate-export";

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
  item_type: string;
  drawing_ref?: string | null;
  location_tag?: string | null;
  source_takeoff_id?: string | null;
  pricing_status?: string | null;
  quantity_basis?: string | null;
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
type RestrictedRole = "FieldSuperintendent" | "Subcontractor" | "ClientView";
const RESTRICTED_ROLES: ReadonlySet<string> = new Set<RestrictedRole>(["FieldSuperintendent", "Subcontractor", "ClientView"]);

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
// Converts an authoritative estimate_items row (cost-category dollar totals)
// into the grid's editable per-unit-rate shape. Division is exact (not
// rounded) so a round-trip load -> save reproduces the same dollar totals.
function itemToRow(it: {
  id: string; cost_code: string | null; csi_code?: string | null; description: string | null; quantity: number | null; uom: string | null;
  labor_cost: number | null; material_cost: number | null; equipment_cost: number | null; trucking_cost: number | null;
  subcontract_cost: number | null; disposal_cost: number | null; notes: string | null; sort_order?: number;
  item_type?: string | null; drawing_ref?: string | null; location_tag?: string | null;
  source_takeoff_id?: string | null; pricing_status?: string | null; quantity_basis?: string | null;
}, index: number): EstimateRow {
  const q = it.quantity && it.quantity !== 0 ? it.quantity : 1;
  const perUnit = (value: number | null) => (typeof value === "number" && Number.isFinite(value) ? value / q : 0);
  return {
    id: it.id,
    cost_code: it.csi_code || it.cost_code || "",
    description: it.description ?? "",
    quantity: it.quantity ?? 0,
    unit: it.uom ?? "EA",
    labor_unit: perUnit(it.labor_cost),
    material_unit: perUnit(it.material_cost),
    equipment_unit: perUnit(it.equipment_cost),
    subcontractor_unit: perUnit(it.subcontract_cost),
    trucking_unit: perUnit(it.trucking_cost),
    disposal_unit: perUnit(it.disposal_cost),
    notes: it.notes ?? "",
    sort_order: it.sort_order ?? index,
    item_type: normalizeLineType(it.item_type),
    drawing_ref: it.drawing_ref,
    location_tag: it.location_tag,
    source_takeoff_id: it.source_takeoff_id,
    pricing_status: it.pricing_status,
    quantity_basis: it.quantity_basis,
    _dirty: false,
  };
}

function rowHasRate(row: EstimateRow): boolean {
  return row.labor_unit + row.material_unit + row.equipment_unit + row.subcontractor_unit + row.trucking_unit + row.disposal_unit > 0;
}

function rowCountsTowardSell(row: EstimateRow): boolean {
  if ((row.notes ?? "").startsWith("Source removed")) return false;
  if (row.pricing_status === "unpriced" || row.pricing_status === "review") return false;
  return rowHasRate(row);
}

export default function EstimateMatrix({ projectId, projectName }: Props) {
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [settings, setSettings] = useState<FinancialSettings>({ overhead_pct: 10, profit_pct: 15, contingency_pct: 5 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [moneyHidden, setMoneyHidden] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [versionStatus, setVersionStatus] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ id: string; version_number: number; status: string }[]>([]);
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [moneyView, setMoneyView] = useState<"quantities" | "priced">("priced");
  const [groupBy, setGroupBy] = useState<"division" | "type" | "none">("none");
  const [sortBy, setSortBy] = useState<"sheet" | "description" | "quantity" | "code">("sheet");
  const [versionDiff, setVersionDiff] = useState<{
    added: { description?: string | null; csi_code?: string | null }[];
    removed: { description?: string | null; csi_code?: string | null }[];
    changed: { key: string; changes?: string[]; quantityDelta: number | null; totalDelta: number | null; right: { description?: string | null } }[];
  } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const rowsRef = useRef(rows);
  const settingsRef = useRef(settings);
  const savingRef = useRef(false);
  rowsRef.current = rows;
  settingsRef.current = settings;
  const gridScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = window.localStorage.getItem(`estimate-view:${projectId}`);
    if (view === "quantities" || view === "priced") setMoneyView(view);
    const group = window.localStorage.getItem(`estimate-group:${projectId}:${view === "quantities" ? "quantities" : "priced"}`);
    if (group === "division" || group === "type" || group === "none") setGroupBy(group);
    const sort = window.localStorage.getItem(`estimate-sort:${projectId}:${view === "quantities" ? "quantities" : "priced"}`);
    if (sort === "sheet" || sort === "description" || sort === "quantity" || sort === "code") setSortBy(sort);
  }, [projectId]);

  const displayOrder = useMemo(() => {
    const indexed = rows.map((row, index) => ({ row, index }));
    const groupLabel = (row: EstimateRow) => {
      if (groupBy === "type") return normalizeLineType(row.item_type);
      if (groupBy === "division") return lookupCsi(row.cost_code).division?.code ?? "zz";
      return "";
    };
    indexed.sort((a, b) => {
      const grouped = groupLabel(a.row).localeCompare(groupLabel(b.row));
      if (grouped !== 0) return grouped;
      if (sortBy === "description") return a.row.description.localeCompare(b.row.description);
      if (sortBy === "quantity") return a.row.quantity - b.row.quantity;
      if (sortBy === "code") return a.row.cost_code.localeCompare(b.row.cost_code);
      return a.row.sort_order - b.row.sort_order;
    });
    return indexed.map((entry) => entry.index);
  }, [rows, groupBy, sortBy]);

  const rowVirtualizer = useVirtualizer({
    count: displayOrder.length,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => ESTIMATE_ROW_HEIGHT_PX,
    overscan: 12,
  });

  const pricingRestricted = moneyHidden || (role != null && RESTRICTED_ROLES.has(role));
  const showMoney = moneyView === "priced" && !pricingRestricted;
  const matrixColCount = 8 + (showMoney ? UNIT_COL_KEYS.length + 1 : 0);
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
        financials_redacted?: boolean;
      };
      setVersionId(ver.version.id);
      setVersionNumber(ver.version.version_number);
      setVersionStatus(ver.version.status);
      setMoneyHidden(Boolean(ver.financials_redacted));
      setRows(ver.items.map((it, i) => itemToRow(it, i)));
      setSettings(ver.financials_redacted
        ? { overhead_pct: 0, profit_pct: 0, contingency_pct: 0 }
        : {
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
      const data = await res.json().catch(() => ({})) as {
        error?: string;
        bid_stage_suggestion?: { opportunity_id: string; suggested_stage: string; name?: string };
      };
      if (!res.ok) {
        setSeedResult(`Approve failed: ${data.error ?? res.status}`);
        return;
      }
      await load();
      const sug = data.bid_stage_suggestion;
      if (sug?.opportunity_id && sug.suggested_stage) {
        const ok = window.confirm(
          `Linked bid "${sug.name ?? sug.opportunity_id}" can move to "${sug.suggested_stage}". Update the bid board now?`,
        );
        if (ok) {
          const patch = await fetch(`/api/preconstruction/opportunities/${encodeURIComponent(sug.opportunity_id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage: sug.suggested_stage }),
          });
          if (patch.ok) setSeedResult(`Approved — bid stage set to ${sug.suggested_stage}.`);
          else setSeedResult("Approved — bid stage update failed (update from Bid Board).");
        } else {
          setSeedResult("Approved — bid stage left unchanged.");
        }
      }
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
    const items = rows.filter(rowCountsTowardSell).map((row) => {
      const direct = rowDirect(row);
      const pct = applyVersionPercentages(direct, 0, {
        contingencyPct: settings.contingency_pct,
        overheadPct: settings.overhead_pct,
        profitPct: settings.profit_pct,
      });
      const calc = calculateItem({
        laborCost: row.quantity * row.labor_unit,
        materialCost: row.quantity * row.material_unit,
        equipmentCost: row.quantity * row.equipment_unit,
        truckingCost: row.quantity * row.trucking_unit,
        subcontractCost: row.quantity * row.subcontractor_unit,
        disposalCost: row.quantity * row.disposal_unit,
        quantity: row.quantity,
        contingency: pct.contingency,
        overhead: pct.overhead,
        profit: pct.profit,
      });
      return {
        totalDirectCost: calc.totalDirectCost,
        indirectCost: 0,
        contingency: pct.contingency,
        overhead: pct.overhead,
        profit: pct.profit,
        totalPrice: calc.totalPrice,
        isAlternate: false,
        alternateAccepted: false,
      };
    });
    const rolled = calculateEstimateTotals(items);
    return {
      direct: rolled.totalDirectCost,
      contingency: rolled.totalContingency,
      subtotal: rolled.totalDirectCost + rolled.totalContingency,
      withOverhead: rolled.costBeforeProfit,
      finalBid: rolled.totalPrice,
    };
  }, [rows, settings, rowDirect]);

  const groupSubtotals = useMemo(() => {
    if (groupBy === "none") return [] as { label: string; total: number }[];
    const buckets = new Map<string, number>();
    for (const row of rows) {
      if (!rowCountsTowardSell(row)) continue;
      const label = groupBy === "type"
        ? normalizeLineType(row.item_type)
        : (lookupCsi(row.cost_code).division ? `${lookupCsi(row.cost_code).division?.code} ${lookupCsi(row.cost_code).division?.name}` : "Unassigned");
      buckets.set(label, (buckets.get(label) ?? 0) + rowDirect(row));
    }
    return [...buckets.entries()].map(([label, total]) => ({ label, total }));
  }, [rows, groupBy, rowDirect]);

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
        item_type: "material",
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
        item_type: "material",
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
        item_type: "material",
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
        item_type: "material",
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

  // Converts a row's edited per-unit rates back into cost-category dollar
  // totals for the authoritative estimate_items shape. contingency/overhead/
  // profit are intentionally omitted — the server derives them from the
  // version's percentages (the sliders below), never trusted from here.
  // Reads the latest rows through a ref so a debounced save is not stuck on
  // the render that scheduled it, and merges the PATCH result in place so
  // typing does not refetch and reset the whole matrix.
  const saveAll = useCallback(async (includeSettings = true) => {
    if (savingRef.current || locked || !versionId) return;
    const currentRows = rowsRef.current;
    const dirty = currentRows.filter((r) => r._dirty).map((r) => (
      r.id ? r : { ...r, id: crypto.randomUUID() }
    ));
    if (dirty.length === 0 && !includeSettings) return;
    if (dirty.some((r, i) => r.id !== currentRows.filter((row) => row._dirty)[i]?.id)) {
      setRows((prev) => prev.map((row) => {
        const match = dirty.find((saved) => saved._local && saved._local === row._local && !row.id);
        return match?.id ? { ...row, id: match.id } : row;
      }));
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/estimate/versions/${encodeURIComponent(versionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: dirty.map((r) => ({
            id: r.id,
            cost_code: r.cost_code || null,
            description: r.description,
            quantity: r.quantity,
            source_takeoff_id: r.source_takeoff_id,
            uom: r.unit,
            item_type: normalizeLineType(r.item_type),
            csi_code: r.cost_code || null,
            labor_cost: r.quantity * r.labor_unit,
            material_cost: r.quantity * r.material_unit,
            equipment_cost: r.quantity * r.equipment_unit,
            subcontract_cost: r.quantity * r.subcontractor_unit,
            trucking_cost: r.quantity * r.trucking_unit,
            disposal_cost: r.quantity * r.disposal_unit,
            notes: r.notes,
            sort_order: r.sort_order,
          })),
          settings: includeSettings ? settingsRef.current : undefined,
        }),
      });
      if (!res.ok) return;
      const saved = await res.json() as { items?: Parameters<typeof itemToRow>[0][] };
      const savedById = new Map((saved.items ?? []).map((item) => [item.id, item]));
      setRows((prev) => prev.map((row) => {
        if (!row.id || !savedById.has(row.id)) return row;
        const sent = dirty.find((item) => item.id === row.id);
        if (!sent) return row;
        const unchanged =
          row.quantity === sent.quantity &&
          row.cost_code === sent.cost_code &&
          row.description === sent.description &&
          row.unit === sent.unit &&
          row.notes === sent.notes &&
          row.labor_unit === sent.labor_unit &&
          row.material_unit === sent.material_unit &&
          row.equipment_unit === sent.equipment_unit &&
          row.subcontractor_unit === sent.subcontractor_unit &&
          row.trucking_unit === sent.trucking_unit &&
          row.disposal_unit === sent.disposal_unit;
        if (!unchanged) return { ...row, _dirty: true };
        return { ...itemToRow(savedById.get(row.id)!, row.sort_order), _local: row._local, _dirty: false };
      }));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [locked, versionId]);

  const scheduleAutoSave = useCallback(() => {
    if (locked) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveAll(); }, 900);
  }, [locked, saveAll]);

  function updateSetting(key: keyof FinancialSettings, value: number) {
    if (pricingRestricted || locked) return; // markup sliders are locked for these roles / locked versions
    setSettings((s) => ({ ...s, [key]: value }));
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveAll(); }, 400);
  }

  const downloadServerExport = useCallback(async (format: "xlsx" | "pdf" | "csv") => {
    if (!versionId) return;
    const res = await fetch(`/api/estimate/versions/${encodeURIComponent(versionId)}/export?format=${format}&group=${groupBy}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setSeedResult(data.error ?? `Export failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName.replace(/[^\w-]+/g, "_")}_estimate.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }, [versionId, groupBy, projectName]);

  async function draftRates() {
    setSaving(true);
    try {
      const res = await fetch("/api/estimate/import-takeoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; priced?: number; unpriced?: number };
      if (!res.ok) {
        setSeedResult(data.error ?? `Draft rates failed (${res.status})`);
      } else {
        setSeedResult("Draft rates applied from approved quantities. Unpriced lines stay in the grid.");
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  function rememberView(next: "quantities" | "priced") {
    setMoneyView(next);
    window.localStorage.setItem(`estimate-view:${projectId}`, next);
    const group = window.localStorage.getItem(`estimate-group:${projectId}:${next}`);
    const sort = window.localStorage.getItem(`estimate-sort:${projectId}:${next}`);
    if (group === "division" || group === "type" || group === "none") setGroupBy(group);
    if (sort === "sheet" || sort === "description" || sort === "quantity" || sort === "code") setSortBy(sort);
  }

  function rememberGroup(next: "division" | "type" | "none") {
    setGroupBy(next);
    window.localStorage.setItem(`estimate-group:${projectId}:${moneyView}`, next);
  }

  function rememberSort(next: "sheet" | "description" | "quantity" | "code") {
    setSortBy(next);
    window.localStorage.setItem(`estimate-sort:${projectId}:${moneyView}`, next);
  }

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
                <button type="button" onClick={() => void draftRates()} disabled={saving} className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white disabled:opacity-40">Draft rates from approved quantities</button>
                <button type="button" onClick={addRow} className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white">+ Row</button>
                {!pricingRestricted && (
                  <button type="button" onClick={() => setAssemblyModalOpen(true)} className="inline-flex h-9 items-center rounded-full border border-[#00D2FF]/30 bg-[#00D2FF]/10 px-4 text-[11px] font-semibold uppercase tracking-widest text-[#00D2FF] hover:bg-[#00D2FF]/20">Insert Assembly Mix</button>
                )}
                {!pricingRestricted && (versionStatus === "draft" || versionStatus === "review") && (
                  <button type="button" onClick={approveCurrentVersion} disabled={saving} className="inline-flex h-9 items-center rounded-full border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-4 text-[11px] font-semibold uppercase tracking-widest text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-40">Approve Version</button>
                )}
              </>
            )}
            <button type="button" onClick={() => void downloadServerExport("xlsx")} className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85">Excel</button>
            <button type="button" onClick={() => void downloadServerExport("pdf")} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-bold uppercase tracking-widest text-white/80">PDF</button>
            <button type="button" onClick={() => void downloadServerExport("csv")} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-bold uppercase tracking-widest text-white/80">CSV</button>
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

        <div className="border-t border-white/5 px-4 py-2 flex flex-wrap items-center gap-2 text-[11px]">
          <button type="button" onClick={() => rememberView("quantities")} className={`rounded-full px-3 py-1 uppercase tracking-widest ${moneyView === "quantities" ? "bg-white text-black" : "border border-white/15 text-white/60"}`}>Quantities</button>
          <button type="button" onClick={() => rememberView("priced")} className={`rounded-full px-3 py-1 uppercase tracking-widest ${moneyView === "priced" ? "bg-[#CCFF00] text-black" : "border border-white/15 text-white/60"}`}>Priced</button>
          <label className="text-white/40">Group
            <select value={groupBy} onChange={(e) => rememberGroup(e.target.value as "division" | "type" | "none")} className="ml-2 rounded border border-white/10 bg-black/40 px-2 py-1 text-white">
              <option value="none">None</option>
              <option value="division">CSI division</option>
              <option value="type">Line type</option>
            </select>
          </label>
          <label className="text-white/40">Sort
            <select value={sortBy} onChange={(e) => rememberSort(e.target.value as "sheet" | "description" | "quantity" | "code")} className="ml-2 rounded border border-white/10 bg-black/40 px-2 py-1 text-white">
              <option value="sheet">Sheet order</option>
              <option value="code">CSI code</option>
              <option value="description">Description</option>
              <option value="quantity">Quantity</option>
            </select>
          </label>
          {!pricingRestricted && groupSubtotals.map((group) => (
            <span key={group.label} className="text-white/50">{group.label}: ${fmt(group.total)}</span>
          ))}
        </div>
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
                {change.changes?.includes("source") ? " · quantity source changed" : ""}
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
                <th className="border-b border-white/10 px-2 py-2 w-28">Type</th>
                <th className="border-b border-white/10 px-2 py-2 w-28">CSI</th>
                <th className="border-b border-white/10 px-2 py-2 min-w-[260px]">Description</th>
                <th className="border-b border-white/10 px-2 py-2 w-24 text-right">Qty</th>
                <th className="border-b border-white/10 px-2 py-2 w-16">Unit</th>
                <th className="border-b border-white/10 px-2 py-2 w-36">Source</th>
                {showMoney && UNIT_COL_KEYS.map((k) => (
                  <th key={k} className="border-b border-white/10 px-2 py-2 w-24 text-right">{UNIT_COL_LABELS[k]}</th>
                ))}
                {showMoney && <th className="border-b border-white/10 px-2 py-2 w-32 text-right text-white/70">Total</th>}
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
                        <td colSpan={matrixColCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
                      </tr>
                    )}
                    {virtualRows.map((virtualRow) => {
                      const i = displayOrder[virtualRow.index];
                      const r = rows[i];
                      const direct = rowDirect(r);
                      const source = quantitySourceLabel(r);
                      const division = lookupCsi(r.cost_code).division;
                      return (
                        <tr
                          key={r.id ?? r._local}
                          data-index={virtualRow.index}
                          className={`hover:bg-white/[0.02] ${r._dirty ? "bg-[#CCFF00]/[0.03]" : ""}`}
                          style={{ height: ESTIMATE_ROW_HEIGHT_PX }}
                        >
                          <td className="border-b border-white/5 px-2 py-1 text-[10px] font-mono text-white/40">{i + 1}</td>
                          <td className="border-b border-white/5 px-1 py-1">
                            <select value={normalizeLineType(r.item_type)} onChange={(e) => updateRow(i, { item_type: e.target.value })} className="w-full bg-transparent px-1 py-1 text-[11px] focus:outline-none">
                              {ESTIMATE_LINE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                            </select>
                          </td>
                          <td className="border-b border-white/5 px-1 py-1">
                            <input list="csi-sections" value={r.cost_code} onChange={(e) => updateRow(i, { cost_code: e.target.value })} placeholder="03-30-00" title={division ? `${division.code} ${division.name}` : "CSI code"} className="w-full bg-transparent px-1 py-1 text-[11px] font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                          </td>
                          <td className="border-b border-white/5 px-1 py-1">
                            <input value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} className="w-full bg-transparent px-1 py-1 text-xs focus:outline-none focus:bg-white/[0.05] rounded" />
                          </td>
                          <td className="border-b border-white/5 px-1 py-1">
                            {r.source_takeoff_id ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="font-mono text-xs" title="Quantity comes from the linked measurement">{r.quantity}</span>
                                <button type="button" className="text-[9px] uppercase tracking-widest text-white/40 hover:text-white" onClick={() => updateRow(i, { source_takeoff_id: null })}>Unlink</button>
                              </div>
                            ) : (
                              <input type="number" step="0.01" value={r.quantity} onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })} className="w-full bg-transparent px-1 py-1 text-xs text-right font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                            )}
                          </td>
                          <td className="border-b border-white/5 px-1 py-1">
                            <input value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} className="w-full bg-transparent px-1 py-1 text-[11px] font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                          </td>
                          <td className="border-b border-white/5 px-2 py-1 text-[10px] text-white/50" title={r.quantity_basis ?? source}>{source}</td>
                          {showMoney && UNIT_COL_KEYS.map((k) => (
                            <td key={k} className="border-b border-white/5 px-1 py-1">
                              <input type="number" step="0.01" value={r[k]} onChange={(e) => updateRow(i, { [k]: Number(e.target.value) } as Partial<EstimateRow>)} className="w-full bg-transparent px-1 py-1 text-xs text-right font-mono focus:outline-none focus:bg-white/[0.05] rounded" />
                            </td>
                          ))}
                          {showMoney && <td className="border-b border-white/5 px-2 py-1 text-right text-xs font-mono text-white">{rowCountsTowardSell(r) ? `$${fmt(direct)}` : "Unpriced"}</td>}
                          <td className="border-b border-white/5 px-1 py-1 text-center">
                            <button type="button" onClick={() => removeRow(i)} className="text-white/30 hover:text-red-400 text-xs">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                    {paddingBottom > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={matrixColCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        )}
        <datalist id="csi-sections">
          {listCsiSections().map((section) => <option key={section.code} value={section.code}>{section.name}</option>)}
        </datalist>
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
            <p className="col-span-full text-[10px] text-white/40">Unpriced rows and removed sources stay in the grid and are left out of this sell price.</p>
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
        <input type="range" min={0} max={50} step={0.5} value={disabled ? 0 : value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[#CCFF00] disabled:cursor-not-allowed" />
        <input type="number" min={0} max={100} step={0.1} value={disabled ? "" : value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-xs font-mono text-right focus:outline-none focus:border-[#CCFF00] disabled:cursor-not-allowed" />
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
