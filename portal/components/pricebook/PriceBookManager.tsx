"use client";

import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import PageHero from "@/components/layout/PageHero";

import { useConfirm } from "@/components/common/ConfirmDialog";

interface CatalogItem {
  id: string;
  csi_code: string | null;
  description: string;
  trade: string | null;
  uom: string | null;
  unit_cost: number;
}

interface FormState {
  csi_code: string; description: string; trade: string; uom: string; unit_cost: string;
}

const EMPTY: FormState = { csi_code: "", description: "", trade: "", uom: "", unit_cost: "" };

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PriceBookManager() {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/cost-catalog").then((r) => r.json()).then((d: { items?: CatalogItem[] }) => { setItems(d.items ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditId(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (it: CatalogItem) => {
    setEditId(it.id);
    setForm({ csi_code: it.csi_code ?? "", description: it.description, trade: it.trade ?? "", uom: it.uom ?? "", unit_cost: String(it.unit_cost) });
    setShowForm(true);
  };
  const cancel = () => { setShowForm(false); setEditId(null); setForm(EMPTY); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return;
    setSubmitting(true);
    const payload = {
      csi_code: form.csi_code || null, description: form.description.trim(),
      trade: form.trade || null, uom: form.uom || null, unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : 0,
    };
    try {
      if (editId) await fetch(`/api/cost-catalog/${encodeURIComponent(editId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      else await fetch("/api/cost-catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      cancel(); load();
    } finally { setSubmitting(false); }
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: String("Delete this price-book entry?"), destructive: true }))) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/cost-catalog/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => load());
  };

  const q = search.toLowerCase();
  const filtered = q
    ? items.filter((i) => i.description.toLowerCase().includes(q) || (i.csi_code ?? "").toLowerCase().includes(q) || (i.trade ?? "").toLowerCase().includes(q))
    : items;

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors";

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Price Book"
        description='Your reusable unit-cost library. Estimates pull from here via "Apply Prices" — build it once, reuse it on every project.'
        compact
        actions={
          <button onClick={openAdd} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85">
            <Plus size={13} /> Add
          </button>
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8 max-w-5xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-700" />
          <input aria-label="Search price book" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by description, CSI, trade…" className={`${inputCls} pl-8`} />
        </div>
        <button onClick={openAdd} className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
          <Plus size={11} /> Add Entry
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#16161A] p-6 mb-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">{editId ? "Edit Entry" : "New Entry"}</p>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">CSI Code</label><input value={form.csi_code} onChange={(e) => setForm((f) => ({ ...f, csi_code: e.target.value }))} className={`${inputCls} font-mono`} placeholder="03-30-00" /></div>
          <div className="md:col-span-2"><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Description *</label><input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="e.g. 4&quot; slab on grade" /></div>
            <div><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">UOM</label><input value={form.uom} onChange={(e) => setForm((f) => ({ ...f, uom: e.target.value }))} className={inputCls} placeholder="SF" /></div>
            <div><label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Unit Cost ($)</label><input type="number" step="any" min="0" value={form.unit_cost} onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))} className={`${inputCls} font-mono`} placeholder="0.00" /></div>
            <div className="md:col-span-5 flex items-center gap-3 pt-1">
              <button type="submit" disabled={submitting} className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">{submitting ? "Saving…" : editId ? "Save" : "Add"}</button>
              <button type="button" onClick={cancel} className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-[#16161A] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                {["CSI Code", "Description", "UOM", "Unit Cost", ""].map((h) => <th key={h} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                [...Array(4)].map((_, i) => <tr key={i}>{[...Array(5)].map((__, j) => <td key={j} className="px-4 py-3"><div className="h-3 bg-white/5 rounded animate-pulse" style={{ width: j === 1 ? "70%" : "40%" }} /></td>)}</tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-16 text-xs uppercase tracking-widest text-gray-600">{items.length === 0 ? "Your price book is empty — add entries or use 'Save Prices' from an estimate" : "No matches"}</td></tr>
              ) : (
                filtered.map((it) => (
                  <tr key={it.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{it.csi_code ?? "—"}</td>
                    <td className="px-4 py-3 text-white text-xs">{it.description}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{it.uom ?? "—"}</td>
                    <td className="px-4 py-3 text-[#CCFF00] text-xs font-mono font-bold">${money(it.unit_cost)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(it)} aria-label="Edit entry" className="min-h-[40px] text-gray-600 hover:text-white transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button>
                        <button onClick={() => remove(it.id)} aria-label="Delete entry" className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}
