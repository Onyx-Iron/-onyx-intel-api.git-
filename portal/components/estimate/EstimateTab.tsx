"use client";

import { useCallback, useEffect, useState } from "react";
import { DollarSign, Plus, Download, Sheet, Calculator } from "lucide-react";
import { exportToGoogleSheet } from "@/lib/google/sheets";

import { useToast } from "@/components/common/Toast";
import { useConfirm } from "@/components/common/ConfirmDialog";
import EmptyState from "@/components/common/EmptyState";

type ItemType = "material" | "labour" | "equipment" | "subcontract";

interface EstimateItem {
  id: string;
  trade: string | null;
  csi_code: string | null;
  description: string;
  item_type: ItemType;
  quantity: number | null;
  uom: string | null;
  unit_cost: number | null;
  notes: string | null;
  source_takeoff_id?: string | null;
  source_fingerprint?: string | null;
  quantity_basis?: string | null;
  drawing_ref?: string | null;
  location_tag?: string | null;
  pricing_status?: "manual" | "priced" | "unpriced" | "review" | null;
}

interface FormState {
  trade: string;
  csi_code: string;
  description: string;
  item_type: ItemType;
  quantity: string;
  uom: string;
  unit_cost: string;
  notes: string;
}

const TYPE_STYLES: Record<ItemType, string> = {
  material:    "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  labour:      "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  equipment:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
  subcontract: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const TYPE_LABELS: Record<ItemType, string> = {
  material:    "Material",
  labour:      "Labour",
  equipment:   "Equipment",
  subcontract: "Subcontract",
};

const TRADES = [
  "Civil", "Structural", "Concrete", "Masonry", "Steel", "Carpentry",
  "Roofing", "Insulation", "Drywall", "Finishes", "Plumbing", "HVAC",
  "Electrical", "Fire Protection", "Specialty", "General",
];

const UOMS = ["EA", "LF", "SF", "SY", "CY", "TON", "LB", "GAL", "HR", "LS", "MO", "DAY"];

const EMPTY_FORM: FormState = {
  trade: "", csi_code: "", description: "", item_type: "material",
  quantity: "", uom: "", unit_cost: "", notes: "",
};

function fmtMoney(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemTotal(item: EstimateItem): number {
  if (!item.quantity || !item.unit_cost) return 0;
  return item.quantity * item.unit_cost;
}

function sourceLabel(item: EstimateItem): string {
  if (item.drawing_ref && item.location_tag) return `${item.drawing_ref} / ${item.location_tag}`;
  if (item.drawing_ref) return item.drawing_ref;
  if (item.location_tag) return item.location_tag;
  return item.source_takeoff_id ? "Takeoff" : "Manual";
}

function SkeletonRows() {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <tr key={i}>
          {[...Array(10)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 2 ? "70%" : "40%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function ActionIcon({ d, onClick, hoverClass, label }: { d: string; onClick: () => void; hoverClass: string; label?: string }) {
  return (
    <button onClick={onClick} aria-label={label ?? "Action"} className={`min-h-[40px] text-gray-600 ${hoverClass} transition-colors`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
      </svg>
    </button>
  );
}

/**
 * @deprecated Prefer `EstimateMatrix` — the project Estimate tab and
 * `/dashboard/projects/[id]/estimate` both render the versioned matrix now.
 * Kept temporarily for any deep links or storybook mounts.
 */
export default function EstimateTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sheetExporting, setSheetExporting] = useState(false);
  const [priceBusy, setPriceBusy] = useState<null | "apply" | "save">(null);
  const [seeding, setSeeding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const seedCatalog = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const r = await fetch("/api/cost-catalog/seed", { method: "POST" });
      const d = await r.json() as { seeded?: number; message?: string; error?: string };
      if (!r.ok) { toast({ title: String(d.error ?? "Seed failed"), kind: "error" }); return; }
      if (d.seeded === 0) { toast({ title: String(d.message ?? "Catalog already populated."), kind: "info" }); return; }
      toast({ title: String(`Loaded ${d.seeded} starter CSI rates into your Price Book. Use "Apply Prices" to fill unpriced estimate items.`), kind: "success" });
    } finally {
      setSeeding(false);
    }
  };

  const applyPriceBook = async () => {
    if (priceBusy) return;
    setPriceBusy("apply");
    try {
      setErrorMsg(null);
      const r = await fetch("/api/cost-catalog");
      if (!r.ok) {
        toast({ title: String(`Could not load Price Book (${r.status})`), kind: "error" });
        return;
      }
      const d = await r.json() as { items?: Array<{ csi_code: string | null; unit_cost: number }> };
      const byCsi = new Map<string, number>();
      for (const c of d.items ?? []) if (c.csi_code && c.unit_cost > 0 && !byCsi.has(c.csi_code)) byCsi.set(c.csi_code, c.unit_cost);
      let applied = 0;
      let failed = 0;
      for (const it of items) {
        if ((!it.unit_cost || it.unit_cost === 0) && it.csi_code && byCsi.has(it.csi_code)) {
          // Fix: was swallowing per-row failures silently
          const res = await fetch(`/api/estimate/${encodeURIComponent(it.id)}?project_id=${encodeURIComponent(projectId)}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ unit_cost: byCsi.get(it.csi_code) }),
          }).catch(() => null);
          if (res && res.ok) applied++; else failed++;
        }
      }
      if (applied === 0 && failed === 0) toast({ title: String("No price-book matches for unpriced items (matched by CSI code). Add prices and use 'Save to Price Book' to build your library."), kind: "info" });
      else if (failed > 0) setErrorMsg(`Applied ${applied} prices; ${failed} update(s) failed.`);
      load();
    } catch {
      setErrorMsg("Network error — could not apply price book.");
    } finally { setPriceBusy(null); }
  };

  const saveToPriceBook = async () => {
    if (priceBusy) return;
    setPriceBusy("save");
    try {
      const r = await fetch("/api/cost-catalog");
      if (!r.ok) {
        toast({ title: String(`Could not load Price Book (${r.status})`), kind: "error" });
        return;
      }
      const d = await r.json() as { items?: Array<{ csi_code: string | null; description: string }> };
      const existing = new Set((d.items ?? []).map((c) => `${c.csi_code ?? ""}|${c.description.toLowerCase()}`));
      let saved = 0;
      let failed = 0;
      for (const it of items) {
        if (it.unit_cost && it.unit_cost > 0) {
          const key = `${it.csi_code ?? ""}|${it.description.toLowerCase()}`;
          if (!existing.has(key)) {
            // Fix: was swallowing per-row failures silently
            const res = await fetch("/api/cost-catalog", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ csi_code: it.csi_code, description: it.description, trade: it.trade, uom: it.uom, unit_cost: it.unit_cost }),
            }).catch(() => null);
            if (res && res.ok) { existing.add(key); saved++; } else { failed++; }
          }
        }
      }
      toast({
        title: String(
          saved > 0
            ? `Saved ${saved} item${saved !== 1 ? "s" : ""} to your Price Book — reuse them on any project.${failed > 0 ? ` (${failed} failed)` : ""}`
            : "All priced items are already in your Price Book.",
        ),
        kind: failed > 0 && saved === 0 ? "error" : saved > 0 ? "success" : "info",
      });
    } catch {
      setErrorMsg("Network error — could not save to price book.");
    } finally { setPriceBusy(null); }
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/estimate?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: EstimateItem[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const totalByType = (type: ItemType) =>
    items.filter((i) => i.item_type === type).reduce((s, i) => s + itemTotal(i), 0);
  const grandTotal = items.reduce((s, i) => s + itemTotal(i), 0);
  const sourceBacked = items.filter((i) => i.source_takeoff_id || i.source_fingerprint).length;
  const unpriced = items.filter((i) => !i.unit_cost || i.unit_cost <= 0).length;
  const reviewNeeded = items.filter((i) => i.pricing_status === "review").length;
  const missingEvidence = items.filter((i) => (i.source_takeoff_id || i.source_fingerprint) && !i.quantity_basis && !i.drawing_ref).length;

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (item: EstimateItem) => {
    setEditId(item.id);
    setForm({
      trade:       item.trade ?? "",
      csi_code:    item.csi_code ?? "",
      description: item.description,
      item_type:   item.item_type,
      quantity:    item.quantity != null ? String(item.quantity) : "",
      uom:         item.uom ?? "",
      unit_cost:   item.unit_cost != null ? String(item.unit_cost) : "",
      notes:       item.notes ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return;
    setSubmitting(true);
    const payload = {
      project_id:  projectId,
      trade:       form.trade || null,
      csi_code:    form.csi_code || null,
      description: form.description.trim(),
      item_type:   form.item_type,
      quantity:    form.quantity ? parseFloat(form.quantity) : null,
      uom:         form.uom || null,
      unit_cost:   form.unit_cost ? parseFloat(form.unit_cost) : null,
      notes:       form.notes || null,
    };
    try {
      setErrorMsg(null);
      const res = editId
        ? await fetch(`/api/estimate/${encodeURIComponent(editId)}?project_id=${encodeURIComponent(projectId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof d?.error === "string" ? d.error : `Save failed (${res.status})`);
        return;
      }
      cancelForm();
      load();
    } catch {
      setErrorMsg("Network error — could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (!(await confirm({ title: String("Delete this estimate item?"), destructive: true }))) return;
    setErrorMsg(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/estimate/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) {
        setErrorMsg(`Delete failed (${res.status}) — refreshing list.`);
        load();
      }
    } catch {
      setErrorMsg("Network error — could not delete.");
      load();
    }
  };

  const importFromTakeoff = async () => {
    setImporting(true);
    try {
      const r = await fetch("/api/estimate/import-takeoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const d = await r.json() as { imported?: number; skipped?: number; priced?: number; unpriced?: number; review?: number; error?: string };
      if (!r.ok) {
        toast({ title: String(d.error ?? `Import failed (${r.status})`), kind: "error" });
        return;
      }
      if ((d.imported ?? 0) === 0) {
        toast({ title: String((d.skipped ?? 0) > 0 ? "All takeoff items are already in this estimate." : "No takeoff items found for this project."), kind: "info" });
      } else {
        toast({ title: String(`Imported ${d.imported} takeoff item${d.imported === 1 ? "" : "s"} (${d.priced ?? 0} priced, ${d.unpriced ?? 0} need pricing, ${d.review ?? 0} need review).`), kind: "success" });
      }
      load();
    } finally {
      setImporting(false);
    }
  };

  const exportCsv = () => {
    const rows = [
      ["Trade", "CSI Code", "Description", "Type", "Qty", "UOM", "Unit Cost", "Total", "Source", "Basis", "Notes"],
      ...items.map((i) => [
        i.trade ?? "",
        i.csi_code ?? "",
        i.description,
        i.item_type,
        i.quantity ?? "",
        i.uom ?? "",
        i.unit_cost != null ? i.unit_cost : "",
        fmtMoney(itemTotal(i)),
        sourceLabel(i),
        i.quantity_basis ?? "",
        i.notes ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `estimate-${projectId.slice(0, 8)}.csv`;
    a.click();
  };

  const exportSheet = async () => {
    if (items.length === 0 || sheetExporting) return;
    setSheetExporting(true);
    try {
      const url = await exportToGoogleSheet({
        title: `Onyx Estimate — ${new Date().toLocaleDateString("en-US")}`,
        headers: ["Trade", "CSI Code", "Description", "Type", "Qty", "UOM", "Unit Cost", "Total", "Source", "Basis", "Notes"],
        rows: items.map((i) => [
          i.trade ?? "",
          i.csi_code ?? "",
          i.description,
          i.item_type,
          i.quantity ?? 0,
          i.uom ?? "",
          i.unit_cost ?? 0,
          itemTotal(i),
          sourceLabel(i),
          i.quantity_basis ?? "",
          i.notes ?? "",
        ]),
      });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ title: String(`Google Sheets export failed: ${err instanceof Error ? err.message : String(err)}`), kind: "error" });
    } finally {
      setSheetExporting(false);
    }
  };

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors";

  const previewTotal =
    form.quantity && form.unit_cost
      ? fmtMoney(parseFloat(form.quantity) * parseFloat(form.unit_cost))
      : null;

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button onClick={() => setErrorMsg(null)} className="text-[10px] text-gray-500 hover:text-white uppercase tracking-widest">Dismiss</button>
        </div>
      )}
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["material", "labour", "equipment", "subcontract"] as ItemType[]).map((type) => (
          <div key={type} className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
            <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">{TYPE_LABELS[type]}</p>
            <p className="text-xl font-black text-white leading-none">${fmtMoney(totalByType(type))}</p>
          </div>
        ))}
        <div className="rounded-xl border border-[#CCFF00]/20 bg-[#CCFF00]/5 p-4">
          <p className="text-[9px] uppercase tracking-widest text-[#CCFF00]/60 mb-1">Grand Total</p>
          <p className="text-xl font-black text-[#CCFF00] leading-none">${fmtMoney(grandTotal)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Source-backed</p>
          <p className="text-xl font-black text-[#00D2FF] leading-none">{sourceBacked}/{items.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Needs Pricing</p>
          <p className={`text-xl font-black leading-none ${unpriced > 0 ? "text-orange-400" : "text-[#CCFF00]"}`}>{unpriced}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Needs Review</p>
          <p className={`text-xl font-black leading-none ${reviewNeeded > 0 ? "text-orange-400" : "text-[#CCFF00]"}`}>{reviewNeeded}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Missing Evidence</p>
          <p className={`text-xl font-black leading-none ${missingEvidence > 0 ? "text-[#E50914]" : "text-[#CCFF00]"}`}>{missingEvidence}</p>
        </div>
      </div>

      {/* Table panel */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <DollarSign size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Estimate</span>
            {items.length > 0 && (
              <span className="text-[9px] text-gray-700 font-mono">{items.length} items</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors disabled:opacity-30"
            >
              <Download size={10} />
              CSV
            </button>
            <button
              onClick={exportSheet}
              disabled={items.length === 0 || sheetExporting}
              className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors disabled:opacity-30"
            >
              <Sheet size={10} />
              {sheetExporting ? "Exporting…" : "Sheets"}
            </button>
            <button
              onClick={seedCatalog}
              disabled={seeding}
              title="Load starter CSI division rates into your Price Book"
              className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors disabled:opacity-30"
            >
              {seeding ? "Loading…" : "Starter Rates"}
            </button>
            <button
              onClick={applyPriceBook}
              disabled={items.length === 0 || priceBusy !== null}
              title="Fill unit costs from your saved Price Book (matched by CSI code)"
              className="bg-[#00D2FF]/10 border border-[#00D2FF]/30 text-[#00D2FF] hover:bg-[#00D2FF]/20 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-30"
            >
              {priceBusy === "apply" ? "Applying…" : "Apply Prices"}
            </button>
            <button
              onClick={saveToPriceBook}
              disabled={items.length === 0 || priceBusy !== null}
              title="Save priced line items to your reusable Price Book"
              className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors disabled:opacity-30"
            >
              {priceBusy === "save" ? "Saving…" : "Save Prices"}
            </button>
            <button
              onClick={importFromTakeoff}
              disabled={importing}
              className="bg-[#00D2FF]/10 border border-[#00D2FF]/30 text-[#00D2FF] hover:bg-[#00D2FF]/20 rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import Takeoff"}
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              <Plus size={11} />
              Add Item
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                {["Trade", "CSI Code", "Description", "Type", "Qty", "UOM", "Unit Cost", "Total", "Source", ""].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows />
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <div className="py-4">
                      <EmptyState
                        icon={<Calculator className="w-6 h-6" />}
                        title="No estimate yet"
                        description="Generate an estimate from your takeoff or add line items manually."
                        actionLabel="Add Line Item"
                        onAction={openAdd}
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-gray-400 text-xs">{item.trade ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{item.csi_code ?? "—"}</td>
                    <td className="px-4 py-3 text-white text-xs max-w-[220px] truncate" title={item.description}>
                      {item.description}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${TYPE_STYLES[item.item_type]}`}>
                        {TYPE_LABELS[item.item_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono text-right">
                      {item.quantity != null ? item.quantity : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{item.uom ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono text-right">
                      {item.unit_cost != null ? `$${fmtMoney(item.unit_cost)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono font-bold text-right">
                      {itemTotal(item) > 0
                        ? <span className="text-white">${fmtMoney(itemTotal(item))}</span>
                        : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate" title={item.quantity_basis ?? item.notes ?? ""}>
                      {sourceLabel(item)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ActionIcon
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          onClick={() => openEdit(item)}
                          hoverClass="hover:text-white"
                          label="Edit item"
                        />
                        <ActionIcon
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          onClick={() => deleteItem(item.id)}
                          hoverClass="hover:text-[#E50914]"
                          label="Delete item"
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">
            {editId ? "Edit Estimate Item" : "New Estimate Item"}
          </p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Description *</label>
                <input
                  type="text"
                  required
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className={inputCls}
                  placeholder='e.g. 3/4" CPVC supply piping'
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Type</label>
                <select
                  value={form.item_type}
                  onChange={(e) => setForm((f) => ({ ...f, item_type: e.target.value as ItemType }))}
                  className={inputCls}
                >
                  <option value="material">Material</option>
                  <option value="labour">Labour</option>
                  <option value="equipment">Equipment</option>
                  <option value="subcontract">Subcontract</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Trade</label>
                <input
                  type="text"
                  list="est-trade-opts"
                  value={form.trade}
                  onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. Plumbing"
                />
                <datalist id="est-trade-opts">
                  {TRADES.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">CSI Code</label>
                <input
                  type="text"
                  value={form.csi_code}
                  onChange={(e) => setForm((f) => ({ ...f, csi_code: e.target.value }))}
                  className={`${inputCls} font-mono`}
                  placeholder="22-11-16"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Quantity</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  className={`${inputCls} font-mono`}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">UOM</label>
                <input
                  type="text"
                  list="est-uom-opts"
                  value={form.uom}
                  onChange={(e) => setForm((f) => ({ ...f, uom: e.target.value }))}
                  className={inputCls}
                  placeholder="LF"
                />
                <datalist id="est-uom-opts">
                  {UOMS.map((u) => <option key={u} value={u} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Unit Cost ($)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={form.unit_cost}
                  onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))}
                  className={`${inputCls} font-mono`}
                  placeholder="0.00"
                />
              </div>
              <div className="flex items-end">
                <div className="w-full bg-[#0A0A0B]/50 border border-white/5 rounded-lg px-3 py-2.5">
                  <p className="text-[9px] uppercase tracking-widest text-gray-700">Line Total</p>
                  <p className={`text-sm font-mono font-bold ${previewTotal ? "text-[#CCFF00]" : "text-gray-700"}`}>
                    {previewTotal ? `$${previewTotal}` : "—"}
                  </p>
                </div>
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls}
                  placeholder="Optional notes or assumptions"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
              >
                {submitting ? "Saving…" : editId ? "Save Changes" : "Add Item"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
