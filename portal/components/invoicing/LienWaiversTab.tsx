"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";
import { Shield, Plus } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import EmptyState from "@/components/common/EmptyState";
import { useBulkImport, toStr, toNum, toDate } from "@/components/common/useBulkImport";
import { LienWaiver, INPUT_CLS, fmtDate, fmtCurrency, pickField } from "./_shared";

import { useConfirm } from "@/components/common/ConfirmDialog";

type WaiverStatus = "pending" | "received" | "expired";

const STATUS_STYLES: Record<WaiverStatus, string> = {
  pending:  "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  received: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  expired:  "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

const WAIVER_TYPES = [
  "conditional_progress", "unconditional_progress",
  "conditional_final", "unconditional_final",
];

const WAIVER_TYPE_LABELS: Record<string, string> = {
  conditional_progress:   "Conditional · Progress",
  unconditional_progress: "Unconditional · Progress",
  conditional_final:      "Conditional · Final",
  unconditional_final:    "Unconditional · Final",
};

interface FormState {
  vendor_name: string;
  waiver_type: string;
  draw_number: string;
  amount: string;
  through_date: string;
  state: string;
  signed_at: string;
  signed_by: string;
  status: WaiverStatus;
  notes: string;
}
const EMPTY_FORM: FormState = {
  vendor_name: "", waiver_type: "conditional_progress", draw_number: "",
  amount: "", through_date: "", state: "", signed_at: "", signed_by: "",
  status: "pending", notes: "",
};

interface LienWaiverPayload {
  project_id: string;
  vendor_name: string;
  waiver_type: string;
  draw_number: string | null;
  amount: number | null;
  through_date: string | null;
  state: string | null;
  signed_by: string | null;
  status: WaiverStatus;
  notes: string | null;
}
function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "55%" : "35%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
export default function LienWaiversTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<LienWaiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/lien-waivers?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: LienWaiver[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  useProjectSyncRefresh(load);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const importItems = useBulkImport<LienWaiverPayload>(projectId, {
    endpoint: "/api/lien-waivers",
    mapRow: (row, pid) => {
      const vendor = toStr(pickField(row, ["vendor", "vendorname", "subcontractor", "supplier", "company"]));
      if (!vendor) return null;
      const rawType = (toStr(pickField(row, ["waivertype", "type"])) ?? "conditional_progress").toLowerCase().replace(/[\s\-]/g, "_");
      const waiverType = WAIVER_TYPES.includes(rawType) ? rawType : "conditional_progress";
      return {
        project_id: pid,
        vendor_name: vendor,
        waiver_type: waiverType,
        draw_number: toStr(pickField(row, ["drawnumber", "draw", "drawno"])),
        amount: toNum(pickField(row, ["amount", "total"])),
        through_date: toDate(pickField(row, ["throughdate", "through", "date"])),
        state: toStr(pickField(row, ["state", "jurisdiction"])),
        signed_by: toStr(pickField(row, ["signedby", "signer"])),
        status: "pending" as WaiverStatus,
        notes: toStr(pickField(row, ["notes", "comments"])),
      };
    },
    onComplete: () => load(),
  });

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (w: LienWaiver) => {
    setEditId(w.id);
    setForm({
      vendor_name:  w.vendor_name,
      waiver_type:  w.waiver_type,
      draw_number:  w.draw_number ?? "",
      amount:       w.amount == null ? "" : String(w.amount),
      through_date: w.through_date ?? "",
      state:        w.state ?? "",
      signed_at:    w.signed_at ? w.signed_at.slice(0, 10) : "",
      signed_by:    w.signed_by ?? "",
      status:       w.status,
      notes:        w.notes ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.vendor_name.trim()) {
      setErrorMsg("Vendor name is required.");
      return;
    }
    setSubmitting(true);
    const payload = {
      project_id: projectId,
      vendor_name: form.vendor_name.trim(),
      waiver_type: form.waiver_type,
      draw_number: form.draw_number || null,
      amount: form.amount === "" ? null : Number(form.amount),
      through_date: form.through_date || null,
      state: form.state || null,
      signed_at: form.signed_at ? new Date(form.signed_at).toISOString() : null,
      signed_by: form.signed_by || null,
      status: form.status,
      notes: form.notes || null,
    };
    try {
      setErrorMsg(null);
      const res = editId
        ? await fetch(`/api/lien-waivers/${encodeURIComponent(editId)}?project_id=${encodeURIComponent(projectId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/lien-waivers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `Could not save this lien waiver (${res.status}). Check the form and try again.`);
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
    if (!(await confirm({ title: String("Delete this lien waiver?"), destructive: true }))) return;
    const prev = items;
    setItems((curr) => curr.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/lien-waivers/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) { setItems(prev); setErrorMsg(`Could not delete that lien waiver (${res.status}). Refresh the list and try again.`); }
    } catch {
      setItems(prev);
      setErrorMsg("Could not delete that lien waiver just now. Refresh the list and try again in a moment.");
    }
  };

  const received = items.filter((i) => i.status === "received").length;
  const pending  = items.filter((i) => i.status === "pending").length;
  const expired  = items.filter((i) => i.status === "expired").length;

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button type="button" onClick={() => setErrorMsg(null)} className="min-h-[40px] text-[10px] text-gray-500 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Received", value: received, color: "text-[#CCFF00]" },
          { label: "Pending",  value: pending,  color: "text-[#00D2FF]" },
          { label: "Expired",  value: expired,  color: "text-[#E50914]" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
            <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">{s.label}</p>
            <p className={`text-2xl font-black leading-none ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Shield size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Lien Waivers</span>
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton hint="lien waiver" onParsed={importItems} caption="Excel, CSV, PDF" />
            <button onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
              <Plus size={11} /> Add Waiver
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                {["Vendor", "Type", "Draw #", "Amount", "Through Date", "State", "Signed By", "Status", ""].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows cols={9} />
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16">
                  <div className="py-4">
                    <EmptyState
                      icon={<Shield className="w-6 h-6" />}
                      title="No lien waivers yet"
                      description="Lien waivers will appear here once you add them on a project or record one from an invoice workflow."
                      actionLabel="Open projects"
                      actionHref="/dashboard/projects"
                      secondaryLabel="View invoices"
                      secondaryHref="/dashboard/financials"
                    />
                  </div>
                </td></tr>
              ) : (
                items.map((w) => (
                  <tr key={w.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-white text-xs">{w.vendor_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{WAIVER_TYPE_LABELS[w.waiver_type] ?? w.waiver_type}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{w.draw_number ?? "-"}</td>
                    <td className="px-4 py-3 text-white text-xs font-mono">{fmtCurrency(w.amount)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(w.through_date)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{w.state ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{w.signed_by ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[w.status]}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" aria-label="Edit lien waiver" onClick={() => openEdit(w)} className="min-h-[40px] text-gray-600 hover:text-white">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button type="button" aria-label="Delete lien waiver" onClick={() => deleteItem(w.id)} className="min-h-[40px] text-gray-600 hover:text-[#E50914]">
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
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">{editId ? "Edit Lien Waiver" : "New Lien Waiver"}</p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Vendor *</label>
                <input type="text" required value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Waiver Type</label>
                <select value={form.waiver_type} onChange={(e) => setForm((f) => ({ ...f, waiver_type: e.target.value }))} className={INPUT_CLS}>
                  {WAIVER_TYPES.map((t) => <option key={t} value={t}>{WAIVER_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Draw #</label>
                <input type="text" value={form.draw_number} onChange={(e) => setForm((f) => ({ ...f, draw_number: e.target.value }))} className={`${INPUT_CLS} font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Amount</label>
                <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={`${INPUT_CLS} font-mono`} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Through Date</label>
                <input type="date" value={form.through_date} onChange={(e) => setForm((f) => ({ ...f, through_date: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">State</label>
                <input type="text" maxLength={2} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))} className={INPUT_CLS} placeholder="TX" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Signed At</label>
                <input type="date" value={form.signed_at} onChange={(e) => setForm((f) => ({ ...f, signed_at: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Signed By</label>
                <input type="text" value={form.signed_by} onChange={(e) => setForm((f) => ({ ...f, signed_by: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as WaiverStatus }))} className={INPUT_CLS}>
                  <option value="pending">Pending</option>
                  <option value="received">Received</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Notes</label>
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={INPUT_CLS} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving..." : editId ? "Save Changes" : "Add Waiver"}
              </button>
              <button type="button" onClick={cancelForm}
                className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
