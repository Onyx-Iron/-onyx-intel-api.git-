"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Plus, ListChecks } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import { useBulkImport, toStr, toNum, toDate } from "@/components/common/useBulkImport";

import { useConfirm } from "@/components/common/ConfirmDialog";
import EmptyState from "@/components/common/EmptyState";

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

type Priority    = "low" | "medium" | "high" | "critical";
type PunchStatus = "open" | "in_progress" | "complete" | "approved";

interface PunchItem {
  id: string;
  item_number: number | null;
  description: string;
  location: string | null;
  trade: string | null;
  responsible: string | null;
  priority: Priority;
  status: PunchStatus;
  due_date: string | null;
  sign_off: string | null;
  notes: string | null;
}

interface FormState {
  description: string;
  location: string;
  trade: string;
  responsible: string;
  priority: Priority;
  status: PunchStatus;
  due_date: string;
  sign_off: string;
  notes: string;
}

const PRIORITY_STYLES: Record<Priority, string> = {
  low:      "bg-gray-500/10 text-gray-400 border-gray-500/20",
  medium:   "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  high:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  critical: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

const STATUS_STYLES: Record<PunchStatus, string> = {
  open:        "bg-white/5 text-gray-500 border-white/10",
  in_progress: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  complete:    "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  approved:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

const STATUS_LABELS: Record<PunchStatus, string> = {
  open: "Open", in_progress: "In Progress", complete: "Complete", approved: "Approved",
};

const STATUS_CYCLE: PunchStatus[] = ["open", "in_progress", "complete", "approved"];

const EMPTY_FORM: FormState = {
  description: "", location: "", trade: "", responsible: "",
  priority: "medium", status: "open", due_date: "", sign_off: "", notes: "",
};

function fmtDate(d: string | null): string {
  if (!d) return "â€”";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 1 ? "65%" : "35%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function PunchListTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<PunchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<PunchStatus | "all">("all");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/punch-list?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { items?: PunchItem[] };
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]);

  const importItems = useBulkImport<{ project_id: string; description: string; location: string | null; priority: Priority; status: PunchStatus; assigned_to: string | null }>(projectId, {
    endpoint: "/api/punch-list",
    mapRow: (row, pid) => {
      const description = toStr(pickField(row, ["description", "issue", "item", "name", "title", "task"]));
      if (!description) return null;
      const prioRaw = (toStr(pickField(row, ["priority", "severity"])) ?? "medium").toLowerCase();
      const priority: Priority = prioRaw.includes("crit") ? "critical" : prioRaw.includes("high") ? "high" : prioRaw.includes("low") ? "low" : "medium";
      const statusRaw = (toStr(pickField(row, ["status", "state"])) ?? "open").toLowerCase().replace(/[\s_-]/g, "");
      const status: PunchStatus = statusRaw.includes("progress") ? "in_progress" : statusRaw.includes("approve") ? "approved" : statusRaw.includes("complete") || statusRaw === "done" ? "complete" : "open";
      return {
        project_id: pid,
        description,
        location: toStr(pickField(row, ["location", "room", "area", "where"])),
        priority,
        status,
        assigned_to: toStr(pickField(row, ["assignedto", "assignee", "owner", "responsible"])),
      };
    },
    onComplete: () => load(),
  });

  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);

  const cycleStatus = async (item: PunchItem) => {
    const idx = STATUS_CYCLE.indexOf(item.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: next } : i));
    try {
      const res = await fetch(`/api/punch-list/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        // Fix: was swallowing failure silently — surface error and roll back via reload
        setErrorMsg(`Status update failed (${res.status})`);
        load();
      }
    } catch {
      setErrorMsg("Network error — could not update status.");
      load();
    }
  };

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (item: PunchItem) => {
    setEditId(item.id);
    setForm({
      description: item.description,
      location:    item.location ?? "",
      trade:       item.trade ?? "",
      responsible: item.responsible ?? "",
      priority:    item.priority,
      status:      item.status,
      due_date:    item.due_date ?? "",
      sign_off:    item.sign_off ?? "",
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
      description: form.description.trim(),
      location:    form.location || null,
      trade:       form.trade || null,
      responsible: form.responsible || null,
      priority:    form.priority,
      status:      form.status,
      due_date:    form.due_date || null,
      sign_off:    form.sign_off || null,
      notes:       form.notes || null,
    };
    try {
      setErrorMsg(null);
      // Fix: was swallowing API errors — now check res.ok and surface message
      const res = editId
        ? await fetch(`/api/punch-list/${encodeURIComponent(editId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/punch-list", {
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
    if (!(await confirm({ title: String("Delete this punch list item?"), destructive: true }))) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/punch-list/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        // Fix: optimistic delete with no rollback on API failure
        setErrorMsg(`Delete failed (${res.status}) — refreshing list.`);
        load();
      }
    } catch {
      setErrorMsg("Network error — could not delete.");
      load();
    }
  };

  const counts: Record<PunchStatus, number> = {
    open:        items.filter((i) => i.status === "open").length,
    in_progress: items.filter((i) => i.status === "in_progress").length,
    complete:    items.filter((i) => i.status === "complete").length,
    approved:    items.filter((i) => i.status === "approved").length,
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
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {(["open", "in_progress", "complete", "approved"] as PunchStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? "all" : s)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              filter === s ? "border-white/30 bg-white/5" : "border-white/10 bg-[#0E0F12] hover:border-white/20"
            }`}
          >
            <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">{STATUS_LABELS[s]}</p>
            <p className={`text-2xl font-black leading-none ${
              s === "open" ? "text-gray-400"
              : s === "in_progress" ? "text-[#00D2FF]"
              : s === "complete" ? "text-[#CCFF00]"
              : "text-emerald-400"
            }`}>{counts[s]}</p>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ClipboardList size={12} className="text-[#E50914]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Punch List</span>
            {filter !== "all" && (
              <span className="text-[9px] text-gray-700 uppercase tracking-widest">
                â€” {STATUS_LABELS[filter]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton
              hint="punch"
              onParsed={importItems}
              accept=".xlsx,.xls,.csv,.docx,.pdf"
            />
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
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                {["#", "Description", "Location", "Trade", "Priority", "Status", "Due Date", "Sign-off", ""].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows cols={9} />
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="py-4">
                      {filter === "all" ? (
                        <EmptyState
                          icon={<ListChecks className="w-6 h-6" />}
                          title="No punch list items"
                          description="Track outstanding items before closeout."
                          actionLabel="Add Item"
                          onAction={openAdd}
                        />
                      ) : (
                        <EmptyState
                          icon={<ListChecks className="w-6 h-6" />}
                          title={`No ${STATUS_LABELS[filter].toLowerCase()} items`}
                          description="Clear this filter to see all punch list items, or add a new one."
                          actionLabel="Add Item"
                          onAction={openAdd}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                visible.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-4 py-3 text-gray-600 text-xs font-mono">
                      {item.item_number ?? idx + 1}
                    </td>
                    <td className="px-4 py-3 text-white text-xs max-w-[200px] truncate" title={item.description}>
                      {item.description}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{item.location ?? "â€”"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{item.trade ?? "â€”"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${PRIORITY_STYLES[item.priority]}`}>
                        {item.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => cycleStatus(item)}
                        className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase cursor-pointer hover:opacity-80 transition-opacity ${STATUS_STYLES[item.status]}`}
                      >
                        {STATUS_LABELS[item.status]}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(item.due_date)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{item.sign_off ?? "â€”"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button aria-label="Edit punch list item" onClick={() => openEdit(item)} className="min-h-[40px] text-gray-600 hover:text-white transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button aria-label="Delete punch list item" onClick={() => deleteItem(item.id)} className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors">
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
            {editId ? "Edit Punch Item" : "New Punch Item"}
          </p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Description *</label>
                <input type="text" required value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className={inputCls} placeholder="e.g. Ceiling grid missing in corridor 3B" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Location</label>
                <input type="text" value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  className={inputCls} placeholder="e.g. Level 2, Room 204" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Trade</label>
                <input type="text" value={form.trade}
                  onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))}
                  className={inputCls} placeholder="e.g. Drywall" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Responsible</label>
                <input type="text" value={form.responsible}
                  onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))}
                  className={inputCls} placeholder="Name or company" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Priority</label>
                <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
                  className={inputCls}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PunchStatus }))}
                  className={inputCls}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="complete">Complete</option>
                  <option value="approved">Approved</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Due Date</label>
                <input type="date" value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Sign-off</label>
                <input type="text" value={form.sign_off}
                  onChange={(e) => setForm((f) => ({ ...f, sign_off: e.target.value }))}
                  className={inputCls} placeholder="Inspector / PM name" />
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
                {submitting ? "Savingâ€¦" : editId ? "Save Changes" : "Add Item"}
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
