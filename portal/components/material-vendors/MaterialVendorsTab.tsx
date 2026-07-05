"use client";

import { useEffect, useState } from "react";
import { Package, Plus } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import { useBulkImport, toStr, toNum } from "@/components/common/useBulkImport";

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

interface Vendor {
  id: string;
  name: string;
  category: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  unit_price: number | null;
  unit: string | null;
  lead_time_days: number | null;
  notes: string | null;
}

interface FormState {
  name: string;
  category: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  unit_price: string;
  unit: string;
  lead_time_days: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "", category: "", contact_name: "", contact_email: "", contact_phone: "",
  unit_price: "", unit: "", lead_time_days: "", notes: "",
};

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "60%" : "35%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function MaterialVendorsTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/material-vendors?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: Vendor[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  useEffect(() => { load(); }, [projectId]);

  const importItems = useBulkImport<{ project_id: string; name: string; category: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; unit_price: number | null; unit: string | null; lead_time_days: number | null; notes: string | null }>(projectId, {
    endpoint: "/api/material-vendors",
    mapRow: (row, pid) => {
      const name = toStr(pickField(row, ["name", "vendor", "supplier", "company"]));
      if (!name) return null;
      return {
        project_id: pid,
        name,
        category:       toStr(pickField(row, ["category", "type", "material"])),
        contact_name:   toStr(pickField(row, ["contactname", "contact", "rep"])),
        contact_email:  toStr(pickField(row, ["email", "contactemail"])),
        contact_phone:  toStr(pickField(row, ["phone", "contactphone", "tel"])),
        unit_price:     toNum(pickField(row, ["unitprice", "price", "rate", "cost"])),
        unit:           toStr(pickField(row, ["unit", "uom"])),
        lead_time_days: toNum(pickField(row, ["leadtimedays", "leadtime", "leaddays"])),
        notes:          toStr(pickField(row, ["notes", "comments"])),
      };
    },
    onComplete: () => load(),
  });

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (v: Vendor) => {
    setEditId(v.id);
    setForm({
      name: v.name,
      category: v.category ?? "",
      contact_name: v.contact_name ?? "",
      contact_email: v.contact_email ?? "",
      contact_phone: v.contact_phone ?? "",
      unit_price: v.unit_price == null ? "" : String(v.unit_price),
      unit: v.unit ?? "",
      lead_time_days: v.lead_time_days == null ? "" : String(v.lead_time_days),
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
      category: form.category || null,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      unit_price: form.unit_price === "" ? null : Number(form.unit_price),
      unit: form.unit || null,
      lead_time_days: form.lead_time_days === "" ? null : Number(form.lead_time_days),
      notes: form.notes || null,
    };
    try {
      setErrorMsg(null);
      const res = editId
        ? await fetch(`/api/material-vendors/${encodeURIComponent(editId)}?project_id=${encodeURIComponent(projectId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/material-vendors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `Save failed (${res.status})`);
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
    if (!(await confirm({ title: String("Delete this vendor?"), destructive: true }))) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/material-vendors/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) { setErrorMsg(`Delete failed (${res.status})`); load(); }
    } catch {
      setErrorMsg("Network error — could not delete.");
      load();
    }
  };

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#CCFF00]/40 transition-colors";

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button type="button" onClick={() => setErrorMsg(null)} className="min-h-[40px] text-[10px] text-gray-500 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Dismiss</button>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="rounded-xl border border-white/8 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <Package size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-white/55">Material Vendors</span>
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton hint="vendor" onParsed={importItems} accept=".xlsx,.xls,.csv,.docx,.pdf" />
            <button onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
              <Plus size={11} /> Add Vendor
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/8">
                {["Vendor", "Category", "Contact", "Email", "Phone", "Unit Price", "Unit", "Lead Time", ""].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-white/55 font-medium px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows cols={9} />
              ) : items.length === 0 && !error ? (
                <tr><td colSpan={9}>
                  <div className="py-4">
                    <EmptyState
                      icon={<Package className="w-6 h-6" />}
                      title="No material vendors yet"
                      description="Track material suppliers, lead times, and pricing."
                      actionLabel="Add Vendor"
                      onAction={openAdd}
                    />
                  </div>
                </td></tr>
              ) : (
                items.map((v) => (
                  <tr key={v.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-white text-xs">{v.name}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.category ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.contact_name ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.contact_email ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.contact_phone ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs font-mono">{v.unit_price == null ? "—" : `$${v.unit_price}`}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.unit ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.lead_time_days == null ? "—" : `${v.lead_time_days}d`}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" aria-label="Edit vendor" onClick={() => openEdit(v)} className="min-h-[40px] text-white/55 hover:text-white">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button type="button" aria-label="Delete vendor" onClick={() => deleteItem(v.id)} className="min-h-[40px] text-white/55 hover:text-[#E50914]">
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
          <p className="text-[11px] uppercase tracking-widest text-white/55 mb-4">{editId ? "Edit Vendor" : "New Vendor"}</p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Name *</label>
                <input type="text" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="Vendor name" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Category</label>
                <input type="text" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls} placeholder="Concrete, Steel, etc." />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Contact</label>
                <input type="text" value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Email</label>
                <input type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Phone</label>
                <input type="tel" value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Unit Price</label>
                <input type="number" step="0.01" value={form.unit_price} onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Unit</label>
                <input type="text" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className={inputCls} placeholder="ea, sq ft, ton" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Lead Time (days)</label>
                <input type="number" value={form.lead_time_days} onChange={(e) => setForm((f) => ({ ...f, lead_time_days: e.target.value }))} className={inputCls} />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Notes</label>
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving..." : editId ? "Save Changes" : "Add Vendor"}
              </button>
              <button type="button" onClick={cancelForm}
                className="bg-white/5 border border-white/8 text-white/55 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
