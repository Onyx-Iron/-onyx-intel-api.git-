"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";
import { Truck, Wrench, Plus } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import { useBulkImport, toStr, toNum, toDate } from "@/components/common/useBulkImport";

import { useConfirm } from "@/components/common/ConfirmDialog";

function pickField(row: Record<string, string | number | null>, keys: string[]): string | null {
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[\s_-]/g, "");
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase().replace(/[\s_-]/g, "") === norm) {
        return rv == null ? null : String(rv);
      }
    }
  }
  return null;
}

type Status = "rented" | "on_site" | "returned" | "owned";

interface Equipment {
  id: string;
  name: string;
  equipment_type: string | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  on_site_date: string | null;
  return_date: string | null;
  operator: string | null;
  status: Status;
  notes: string | null;
}

interface FormState {
  name: string;
  equipment_type: string;
  daily_rate: string;
  weekly_rate: string;
  monthly_rate: string;
  on_site_date: string;
  return_date: string;
  operator: string;
  status: Status;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "", equipment_type: "", daily_rate: "", weekly_rate: "", monthly_rate: "",
  on_site_date: "", return_date: "", operator: "", status: "rented", notes: "",
};

const STATUS_STYLES: Record<Status, string> = {
  rented:   "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  on_site:  "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  returned: "bg-white/5 text-white/55 border-white/8",
  owned:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

function fmtDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i}>{[...Array(cols)].map((__, j) => (
          <td key={j} className="px-4 py-3"><div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "60%" : "35%" }} /></td>
        ))}</tr>
      ))}
    </>
  );
}

export default function EquipmentSuppliersTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/equipment-suppliers?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: Equipment[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Could not load equipment suppliers. Refresh the page and try again."); setLoading(false); });
  }, [projectId]);

  useProjectSyncRefresh(load);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const importItems = useBulkImport<{ project_id: string; name: string; equipment_type: string | null; daily_rate: number | null; weekly_rate: number | null; monthly_rate: number | null; on_site_date: string | null; return_date: string | null; operator: string | null; status: Status; notes: string | null }>(projectId, {
    endpoint: "/api/equipment-suppliers",
    mapRow: (row, pid) => {
      const name = toStr(pickField(row, ["name", "supplier", "vendor", "company"]));
      if (!name) return null;
      const statusRaw = (toStr(pickField(row, ["status"])) ?? "rented").toLowerCase();
      const status: Status = statusRaw.includes("own") ? "owned" : statusRaw.includes("return") ? "returned" : statusRaw.includes("site") ? "on_site" : "rented";
      return {
        project_id: pid,
        name,
        equipment_type: toStr(pickField(row, ["equipmenttype", "type", "equipment"])),
        daily_rate:     toNum(pickField(row, ["dailyrate", "daily"])),
        weekly_rate:    toNum(pickField(row, ["weeklyrate", "weekly"])),
        monthly_rate:   toNum(pickField(row, ["monthlyrate", "monthly"])),
        on_site_date:   toDate(pickField(row, ["onsitedate", "startdate", "deliverydate"])),
        return_date:    toDate(pickField(row, ["returndate", "enddate"])),
        operator:       toStr(pickField(row, ["operator"])),
        status,
        notes:          toStr(pickField(row, ["notes", "comments"])),
      };
    },
    onComplete: () => load(),
  });

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (v: Equipment) => {
    setEditId(v.id);
    setForm({
      name: v.name,
      equipment_type: v.equipment_type ?? "",
      daily_rate: v.daily_rate == null ? "" : String(v.daily_rate),
      weekly_rate: v.weekly_rate == null ? "" : String(v.weekly_rate),
      monthly_rate: v.monthly_rate == null ? "" : String(v.monthly_rate),
      on_site_date: v.on_site_date ?? "",
      return_date: v.return_date ?? "",
      operator: v.operator ?? "",
      status: v.status,
      notes: v.notes ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    const payload = {
      project_id: projectId,
      name: form.name.trim(),
      equipment_type: form.equipment_type || null,
      daily_rate: form.daily_rate === "" ? null : Number(form.daily_rate),
      weekly_rate: form.weekly_rate === "" ? null : Number(form.weekly_rate),
      monthly_rate: form.monthly_rate === "" ? null : Number(form.monthly_rate),
      on_site_date: form.on_site_date || null,
      return_date: form.return_date || null,
      operator: form.operator || null,
      status: form.status,
      notes: form.notes || null,
    };
    try {
      setErrorMsg(null);
      const res = editId
        ? await fetch(`/api/equipment-suppliers/${encodeURIComponent(editId)}?project_id=${encodeURIComponent(projectId)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          })
        : await fetch("/api/equipment-suppliers", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `Could not save this equipment supplier (${res.status}). Check the form and try again.`);
        return;
      }
      cancelForm();
      load();
    } catch {
      setErrorMsg("Could not reach the server just now. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (!(await confirm({ title: String("Delete this equipment record?"), destructive: true }))) return;
    const prevItems = items;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/equipment-suppliers/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) { setItems(prevItems); setErrorMsg(`Could not delete that equipment supplier (${res.status}). Refresh the list and try again.`); load(); }
    } catch {
      setItems(prevItems);
      setErrorMsg("Could not delete that equipment supplier just now. Refresh the list and try again in a moment.");
      load();
    }
  };

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#CCFF00]/40 transition-colors";

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button type="button" onClick={() => setErrorMsg(null)} className="min-h-[40px] text-[10px] text-white/55 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Dismiss</button>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="rounded-xl border border-white/8 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <Truck size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-white/55">Equipment Suppliers</span>
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton hint="equipment" onParsed={importItems} accept=".xlsx,.xls,.csv,.docx,.pdf" />
            <button onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
              <Plus size={11} /> Add Equipment
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/8">
                {["Supplier", "Equipment", "Daily", "Weekly", "Monthly", "On Site", "Return", "Operator", "Status", ""].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-white/55 font-medium px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (<SkeletonRows cols={10} />) : items.length === 0 && !error ? (
                <tr><td colSpan={10}>
                  <div className="py-4">
                    <EmptyState
                      icon={<Wrench className="w-6 h-6" />}
                      title="No equipment suppliers yet"
                      description="Track equipment rental and supplier contacts so the right crew and equipment are easy to reuse next time."
                      actionLabel="Add Supplier"
                      onAction={openAdd}
                      secondaryLabel="View projects"
                      secondaryHref="/dashboard/projects"
                    />
                  </div>
                </td></tr>
              ) : (
                items.map((v) => (
                  <tr key={v.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-white text-xs">{v.name}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.equipment_type ?? "-"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs font-mono">{v.daily_rate == null ? "-" : `$${v.daily_rate}`}</td>
                    <td className="px-4 py-3 text-white/55 text-xs font-mono">{v.weekly_rate == null ? "-" : `$${v.weekly_rate}`}</td>
                    <td className="px-4 py-3 text-white/55 text-xs font-mono">{v.monthly_rate == null ? "-" : `$${v.monthly_rate}`}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{fmtDate(v.on_site_date)}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{fmtDate(v.return_date)}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.operator ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[v.status]}`}>{v.status.replace("_", " ")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" aria-label="Edit equipment" onClick={() => openEdit(v)} className="min-h-[40px] text-white/55 hover:text-white">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button type="button" aria-label="Delete equipment" onClick={() => deleteItem(v.id)} className="min-h-[40px] text-white/55 hover:text-[#E50914]">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/8 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-white/55 mb-4">{editId ? "Edit Equipment" : "New Equipment"}</p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Supplier *</label>
                <input type="text" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Equipment Type</label>
                <input type="text" value={form.equipment_type} onChange={(e) => setForm((f) => ({ ...f, equipment_type: e.target.value }))} className={inputCls} placeholder="Excavator, Crane, etc." />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Daily Rate</label>
                <input type="number" step="0.01" value={form.daily_rate} onChange={(e) => setForm((f) => ({ ...f, daily_rate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Weekly Rate</label>
                <input type="number" step="0.01" value={form.weekly_rate} onChange={(e) => setForm((f) => ({ ...f, weekly_rate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Monthly Rate</label>
                <input type="number" step="0.01" value={form.monthly_rate} onChange={(e) => setForm((f) => ({ ...f, monthly_rate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">On Site Date</label>
                <input type="date" value={form.on_site_date} onChange={(e) => setForm((f) => ({ ...f, on_site_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Return Date</label>
                <input type="date" value={form.return_date} onChange={(e) => setForm((f) => ({ ...f, return_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Operator</label>
                <input type="text" value={form.operator} onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Status }))} className={inputCls}>
                  <option value="rented">Rented</option>
                  <option value="on_site">On Site</option>
                  <option value="returned">Returned</option>
                  <option value="owned">Owned</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Notes</label>
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving..." : editId ? "Save Changes" : "Add Equipment"}
              </button>
              <button type="button" onClick={cancelForm}
                className="bg-white/5 border border-white/8 text-white/55 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
