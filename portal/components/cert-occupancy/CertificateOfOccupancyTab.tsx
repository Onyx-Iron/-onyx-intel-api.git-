"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Plus } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import { useBulkImport, toStr, toDate } from "@/components/common/useBulkImport";

import { useConfirm } from "@/components/common/ConfirmDialog";

type InspectionType =
  | "building" | "fire" | "health" | "electrical" | "plumbing"
  | "mechanical" | "elevator" | "other";

type Status = "scheduled" | "passed" | "failed" | "conditional" | "canceled";
type CertType = "TCO" | "CO";

interface CoInspection {
  id: string;
  inspection_type: InspectionType;
  scheduled_date: string | null;
  inspector_name: string | null;
  inspector_phone: string | null;
  inspector_email: string | null;
  status: Status;
  result_date: string | null;
  corrective_actions: string | null;
  certificate_number: string | null;
  certificate_issued_date: string | null;
  certificate_type: CertType | null;
  document_id: string | null;
  notes: string | null;
}

interface FormState {
  inspection_type: InspectionType;
  scheduled_date: string;
  inspector_name: string;
  inspector_phone: string;
  inspector_email: string;
  status: Status;
  result_date: string;
  corrective_actions: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  inspection_type: "building",
  scheduled_date: "",
  inspector_name: "",
  inspector_phone: "",
  inspector_email: "",
  status: "scheduled",
  result_date: "",
  corrective_actions: "",
  notes: "",
};

const INSPECTION_TYPES: InspectionType[] = [
  "building", "fire", "health", "electrical", "plumbing", "mechanical", "elevator", "other",
];

const STATUS_STYLES: Record<Status, string> = {
  scheduled:   "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  passed:      "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  conditional: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  failed:      "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  canceled:    "bg-white/5 text-gray-500 border-white/10",
};

const STATUS_LABELS: Record<Status, string> = {
  scheduled: "Scheduled",
  passed: "Passed",
  conditional: "Conditional",
  failed: "Failed",
  canceled: "Canceled",
};

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

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

export default function CertificateOfOccupancyTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<CoInspection[]>([]);
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
    fetch(`/api/co-inspections?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: CoInspection[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [projectId]);

  const importItems = useBulkImport<{
    project_id: string;
    inspection_type: string;
    scheduled_date: string | null;
    inspector_name: string | null;
    inspector_phone: string | null;
    inspector_email: string | null;
    status: string;
    notes: string | null;
  }>(projectId, {
    endpoint: "/api/co-inspections",
    mapRow: (row, pid) => {
      const rawType = toStr(pickField(row, ["inspectiontype", "type", "inspection"]))?.toLowerCase() ?? "building";
      const inspection_type = (INSPECTION_TYPES as string[]).includes(rawType) ? rawType : "other";
      const rawStatus = toStr(pickField(row, ["status", "result"]))?.toLowerCase() ?? "scheduled";
      const status = ["scheduled", "passed", "failed", "conditional", "canceled"].includes(rawStatus) ? rawStatus : "scheduled";
      return {
        project_id: pid,
        inspection_type,
        scheduled_date:  toDate(pickField(row, ["scheduleddate", "date", "scheduled"])),
        inspector_name:  toStr(pickField(row, ["inspectorname", "inspector"])),
        inspector_phone: toStr(pickField(row, ["inspectorphone", "phone"])),
        inspector_email: toStr(pickField(row, ["inspectoremail", "email"])),
        status,
        notes:           toStr(pickField(row, ["notes", "comments"])),
      };
    },
    onComplete: () => load(),
  });

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (it: CoInspection) => {
    setEditId(it.id);
    setForm({
      inspection_type:    it.inspection_type,
      scheduled_date:     it.scheduled_date ?? "",
      inspector_name:     it.inspector_name ?? "",
      inspector_phone:    it.inspector_phone ?? "",
      inspector_email:    it.inspector_email ?? "",
      status:             it.status,
      result_date:        it.result_date ?? "",
      corrective_actions: it.corrective_actions ?? "",
      notes:              it.notes ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const payload = {
      project_id:         projectId,
      inspection_type:    form.inspection_type,
      scheduled_date:     form.scheduled_date || null,
      inspector_name:     form.inspector_name || null,
      inspector_phone:    form.inspector_phone || null,
      inspector_email:    form.inspector_email || null,
      status:             form.status,
      result_date:        form.result_date || null,
      corrective_actions: form.corrective_actions || null,
      notes:              form.notes || null,
    };
    try {
      const res = editId
        ? await fetch(`/api/co-inspections/${encodeURIComponent(editId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/co-inspections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? `Failed to save inspection (${res.status}).`);
        return;
      }
      cancelForm();
      load();
    } catch (err) {
      setErrorMsg(`Failed to save inspection: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (!(await confirm({ title: String("Delete this inspection?"), destructive: true }))) return;
    const prev = items;
    setItems((p) => p.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/co-inspections/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setItems(prev);
        setErrorMsg(`Failed to delete inspection (${res.status}).`);
      }
    } catch {
      setItems(prev);
      setErrorMsg("Failed to delete inspection: network error.");
    }
  };

  const markCertIssued = async (it: CoInspection) => {
    const certNumber = window.prompt("Certificate number:", it.certificate_number ?? "");
    if (certNumber === null) return;
    const certType = window.prompt("Certificate type — enter TCO or CO:", it.certificate_type ?? "CO");
    if (certType === null) return;
    const typeNorm = certType.trim().toUpperCase();
    if (typeNorm !== "TCO" && typeNorm !== "CO") {
      setErrorMsg("Certificate type must be 'TCO' or 'CO'.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const issuedDate = window.prompt("Issued date (YYYY-MM-DD):", it.certificate_issued_date ?? today);
    if (issuedDate === null) return;
    try {
      const res = await fetch(`/api/co-inspections/${encodeURIComponent(it.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          certificate_number: certNumber.trim() || null,
          certificate_type: typeNorm,
          certificate_issued_date: issuedDate.trim() || today,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? `Failed to mark issued (${res.status}).`);
        return;
      }
      load();
    } catch (err) {
      setErrorMsg(`Failed to mark issued: ${err instanceof Error ? err.message : "network error"}`);
    }
  };

  const { passedCount, total, daysSinceCo, latestCertIssued } = useMemo(() => {
    const passedCount = items.filter((i) => i.status === "passed").length;
    const total = items.length;
    const certIssued = items
      .filter((i) => i.certificate_issued_date)
      .sort((a, b) => (b.certificate_issued_date! < a.certificate_issued_date! ? -1 : 1));
    const latest = certIssued[0] ?? null;
    let days: number | null = null;
    if (latest?.certificate_issued_date) {
      const t = new Date(latest.certificate_issued_date).getTime();
      if (Number.isFinite(t)) {
        // eslint-disable-next-line react-hooks/purity
        days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
      }
    }
    return { passedCount, total, daysSinceCo: days, latestCertIssued: latest };
  }, [items]);

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#CCFF00]/40 transition-colors";

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button type="button" onClick={() => setErrorMsg(null)} className="min-h-[40px] text-[10px] text-gray-500 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Dismiss</button>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Passed Inspections</p>
          <p className="text-2xl font-black leading-none text-[#CCFF00]">
            {passedCount}<span className="text-gray-600 text-base font-bold">/{total}</span>
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">
            {latestCertIssued?.certificate_type ? `${latestCertIssued.certificate_type} Issued` : "Certificate"}
          </p>
          <p className="text-2xl font-black leading-none text-white">
            {latestCertIssued?.certificate_number ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">Days Since CO Issued</p>
          <p className="text-2xl font-black leading-none text-[#00D2FF]">
            {daysSinceCo === null ? "—" : daysSinceCo}
          </p>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <BadgeCheck size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Certificate of Occupancy</span>
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton hint="inspection" onParsed={importItems} accept=".xlsx,.xls,.csv,.docx,.pdf" />
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              <Plus size={11} />
              Add Inspection
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                {["Type", "Scheduled", "Inspector", "Status", "Result Date", "Certificate", "Issued", ""].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows cols={8} />
              ) : items.length === 0 && !error ? (
                <tr>
                  <td colSpan={8}>
                    <div className="py-4">
                      <EmptyState
                        icon={<BadgeCheck className="w-6 h-6" />}
                        title="No CO records yet"
                        description="Track certificate of occupancy milestones and inspections."
                        actionLabel="Add Record"
                        onAction={openAdd}
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-white text-xs capitalize">{it.inspection_type}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(it.scheduled_date)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      <div>{it.inspector_name ?? "—"}</div>
                      {it.inspector_phone && (
                        <div className="text-[10px] text-gray-600 font-mono">{it.inspector_phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[it.status]}`}>
                        {STATUS_LABELS[it.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(it.result_date)}</td>
                    <td className="px-4 py-3 text-xs">
                      {it.certificate_number ? (
                        <div>
                          <div className="text-white font-mono">{it.certificate_number}</div>
                          {it.certificate_type && (
                            <div className="text-[10px] text-[#CCFF00] tracking-widest">{it.certificate_type}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(it.certificate_issued_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => markCertIssued(it)}
                          title="Mark TCO/CO Issued"
                          className="text-[10px] uppercase tracking-widest text-[#CCFF00] hover:text-white transition-colors font-bold"
                        >
                          Mark Issued
                        </button>
                        <button type="button" aria-label="Edit inspection" onClick={() => openEdit(it)} className="min-h-[40px] text-gray-600 hover:text-white transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button type="button" aria-label="Delete inspection" onClick={() => deleteItem(it.id)} className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
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
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">
            {editId ? "Edit Inspection" : "New Inspection"}
          </p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Inspection Type *</label>
                <select
                  value={form.inspection_type}
                  onChange={(e) => setForm((f) => ({ ...f, inspection_type: e.target.value as InspectionType }))}
                  className={inputCls}
                >
                  {INSPECTION_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Scheduled Date</label>
                <input type="date" value={form.scheduled_date}
                  onChange={(e) => setForm((f) => ({ ...f, scheduled_date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Status</label>
                <select value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Status }))}
                  className={inputCls}>
                  <option value="scheduled">Scheduled</option>
                  <option value="passed">Passed</option>
                  <option value="conditional">Conditional</option>
                  <option value="failed">Failed</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Inspector Name</label>
                <input type="text" value={form.inspector_name}
                  onChange={(e) => setForm((f) => ({ ...f, inspector_name: e.target.value }))}
                  className={inputCls} placeholder="John Smith" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Inspector Phone</label>
                <input type="text" value={form.inspector_phone}
                  onChange={(e) => setForm((f) => ({ ...f, inspector_phone: e.target.value }))}
                  className={`${inputCls} font-mono`} placeholder="(555) 555-1234" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Inspector Email</label>
                <input type="email" value={form.inspector_email}
                  onChange={(e) => setForm((f) => ({ ...f, inspector_email: e.target.value }))}
                  className={inputCls} placeholder="inspector@city.gov" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Result Date</label>
                <input type="date" value={form.result_date}
                  onChange={(e) => setForm((f) => ({ ...f, result_date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Corrective Actions</label>
                <input type="text" value={form.corrective_actions}
                  onChange={(e) => setForm((f) => ({ ...f, corrective_actions: e.target.value }))}
                  className={inputCls} placeholder="Items to address before re-inspection" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Notes</label>
                <input type="text" value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls} placeholder="Optional notes" />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving…" : editId ? "Save Changes" : "Add Inspection"}
              </button>
              <button type="button" onClick={cancelForm}
                className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
