"use client";

import { useEffect, useState } from "react";
import { Users, HardHat, Plus } from "lucide-react";
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

interface Staff {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  hourly_rate: number | null;
  project_role: string | null;
  certifications: string[] | null;
  assigned_at: string | null;
  removed_at: string | null;
  notes: string | null;
}

interface FormState {
  name: string;
  role: string;
  email: string;
  phone: string;
  hourly_rate: string;
  project_role: string;
  certifications: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "", role: "", email: "", phone: "", hourly_rate: "",
  project_role: "", certifications: "", notes: "",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
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

export default function StaffTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/staff?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: Staff[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  useEffect(() => { load(); }, [projectId]);

  const importItems = useBulkImport<{ project_id: string; name: string; role: string | null; email: string | null; phone: string | null; hourly_rate: number | null; project_role: string | null; certifications: string[] | null; notes: string | null }>(projectId, {
    endpoint: "/api/staff",
    mapRow: (row, pid) => {
      const name = toStr(pickField(row, ["name", "fullname", "employee"]));
      if (!name) return null;
      const certsRaw = toStr(pickField(row, ["certifications", "certs", "licenses"]));
      const certifications = certsRaw ? certsRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : null;
      return {
        project_id: pid,
        name,
        role:         toStr(pickField(row, ["role", "title", "position"])),
        email:        toStr(pickField(row, ["email"])),
        phone:        toStr(pickField(row, ["phone", "tel", "mobile"])),
        hourly_rate:  toNum(pickField(row, ["hourlyrate", "rate", "wage"])),
        project_role: toStr(pickField(row, ["projectrole", "assignment"])),
        certifications,
        notes:        toStr(pickField(row, ["notes", "comments"])),
      };
    },
    onComplete: () => load(),
  });

  const visible = showRemoved ? items : items.filter((i) => !i.removed_at);

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (v: Staff) => {
    setEditId(v.id);
    setForm({
      name: v.name,
      role: v.role ?? "",
      email: v.email ?? "",
      phone: v.phone ?? "",
      hourly_rate: v.hourly_rate == null ? "" : String(v.hourly_rate),
      project_role: v.project_role ?? "",
      certifications: (v.certifications ?? []).join(", "),
      notes: v.notes ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    const certs = form.certifications.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    const payload = {
      project_id: projectId,
      name: form.name.trim(),
      role: form.role || null,
      email: form.email || null,
      phone: form.phone || null,
      hourly_rate: form.hourly_rate === "" ? null : Number(form.hourly_rate),
      project_role: form.project_role || null,
      certifications: certs.length > 0 ? certs : null,
      notes: form.notes || null,
    };
    try {
      setErrorMsg(null);
      const res = editId
        ? await fetch(`/api/staff/${encodeURIComponent(editId)}?project_id=${encodeURIComponent(projectId)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          })
        : await fetch("/api/staff", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `Save failed (${res.status})`);
        return;
      }
      cancelForm();
      load();
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRemoved = async (v: Staff) => {
    const removed_at = v.removed_at ? null : new Date().toISOString();
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(v.id)}?project_id=${encodeURIComponent(projectId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ removed_at }),
      });
      if (!res.ok) { setErrorMsg(`Update failed (${res.status})`); }
      load();
    } catch {
      setErrorMsg("Network error.");
    }
  };

  const deleteItem = async (id: string) => {
    if (!(await confirm({ title: String("Delete this staff record?"), destructive: true }))) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) { setErrorMsg(`Delete failed (${res.status})`); load(); }
    } catch {
      setErrorMsg("Network error.");
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
            <Users size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-white/55">Project Staff</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowRemoved((s) => !s)}
              className="text-[10px] uppercase tracking-widest text-white/55 hover:text-white px-2 py-1 border border-white/8 rounded min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">
              {showRemoved ? "Hide Removed" : "Show Removed"}
            </button>
            <UniversalImportButton hint="staff" onParsed={importItems} accept=".xlsx,.xls,.csv,.docx,.pdf" />
            <button onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
              <Plus size={11} /> Add Staff
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/8">
                {["Name", "Role", "Project Role", "Email", "Phone", "Rate", "Certs", "Assigned", "Status", ""].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-white/55 font-medium px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (<SkeletonRows cols={10} />) : visible.length === 0 && !error ? (
                <tr><td colSpan={10}>
                  <div className="py-4">
                    <EmptyState
                      icon={<HardHat className="w-6 h-6" />}
                      title="No staff assigned"
                      description="Add crew, foremen, and PMs assigned to this project."
                      actionLabel="Add Staff"
                      onAction={openAdd}
                    />
                  </div>
                </td></tr>
              ) : (
                visible.map((v) => (
                  <tr key={v.id} className={`hover:bg-white/[0.02] transition-colors group ${v.removed_at ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 text-white text-xs">{v.name}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.role ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.project_role ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.email ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs font-mono">{v.hourly_rate == null ? "—" : `$${v.hourly_rate}/hr`}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{v.certifications && v.certifications.length > 0 ? v.certifications.join(", ") : "—"}</td>
                    <td className="px-4 py-3 text-white/55 text-xs">{fmtDate(v.assigned_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleRemoved(v)}
                        className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase cursor-pointer hover:opacity-80 transition-opacity ${
                          v.removed_at ? "bg-white/5 text-white/55 border-white/8" : "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20"
                        }`}>
                        {v.removed_at ? "Removed" : "Active"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" aria-label="Edit staff" onClick={() => openEdit(v)} className="min-h-[40px] text-white/55 hover:text-white">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button type="button" aria-label="Delete staff" onClick={() => deleteItem(v.id)} className="min-h-[40px] text-white/55 hover:text-[#E50914]">
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
          <p className="text-[11px] uppercase tracking-widest text-white/55 mb-4">{editId ? "Edit Staff" : "New Staff"}</p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Name *</label>
                <input type="text" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Role</label>
                <input type="text" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={inputCls} placeholder="Foreman, PM, etc." />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Project Role</label>
                <input type="text" value={form.project_role} onChange={(e) => setForm((f) => ({ ...f, project_role: e.target.value }))} className={inputCls} placeholder="Site supervisor" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Hourly Rate</label>
                <input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))} className={inputCls} />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Certifications (comma-separated)</label>
                <input type="text" value={form.certifications} onChange={(e) => setForm((f) => ({ ...f, certifications: e.target.value }))} className={inputCls} placeholder="OSHA 30, Forklift, First Aid" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-white/55 mb-1.5">Notes</label>
                <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving..." : editId ? "Save Changes" : "Add Staff"}
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
