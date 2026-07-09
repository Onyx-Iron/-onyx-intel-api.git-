"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Plus, Trash2, Pencil } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import { useBulkImport, toStr } from "@/components/common/useBulkImport";

import { useConfirm } from "@/components/common/ConfirmDialog";

type TodoStatus = "open" | "in_progress" | "done";
type Priority = "low" | "medium" | "high" | "critical";

interface TodoItem {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: TodoStatus;
  priority: Priority;
  assignee: string | null;
  completed_at: string | null;
  created_at: string;
}

interface FormState {
  title: string;
  notes: string;
  due_date: string;
  status: TodoStatus;
  priority: Priority;
  assignee: string;
}

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

const STATUS_LABELS: Record<TodoStatus, string> = {
  open: "Open", in_progress: "In Progress", done: "Done",
};

const STATUS_STYLES: Record<TodoStatus, string> = {
  open:        "bg-white/5 text-gray-400 border-white/10",
  in_progress: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  done:        "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
};

const PRIORITY_STYLES: Record<Priority, string> = {
  low:      "bg-gray-500/10 text-gray-400 border-gray-500/20",
  medium:   "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  high:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  critical: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

const STATUS_CYCLE: TodoStatus[] = ["open", "in_progress", "done"];

const EMPTY_FORM: FormState = {
  title: "", notes: "", due_date: "",
  status: "open", priority: "medium", assignee: "",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TodoTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<TodoStatus | "all">("all");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/todo-items?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: { items?: TodoItem[] }) => { setItems(d.items ?? []); setLoading(false); })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  }, [projectId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const importTodos = useBulkImport<{
    project_id: string; title: string; notes: string | null;
    due_date: string | null; status: TodoStatus; priority: Priority; assignee: string | null;
  }>(projectId, {
    endpoint: "/api/todo-items",
    mapRow: (row, pid) => {
      const title = toStr(pickField(row, ["title", "task", "todo", "name", "description", "item"]));
      if (!title) return null;
      const prioRaw = (toStr(pickField(row, ["priority"])) ?? "medium").toLowerCase();
      const priority: Priority = prioRaw.includes("crit") ? "critical" : prioRaw.includes("high") ? "high" : prioRaw.includes("low") ? "low" : "medium";
      const statusRaw = (toStr(pickField(row, ["status", "state"])) ?? "open").toLowerCase().replace(/[\s_-]/g, "");
      const status: TodoStatus = statusRaw.includes("progress") ? "in_progress" : (statusRaw.includes("done") || statusRaw.includes("complete")) ? "done" : "open";
      const due = toStr(pickField(row, ["duedate", "due"]));
      return {
        project_id: pid,
        title,
        notes: toStr(pickField(row, ["notes", "description", "details"])),
        due_date: due && /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : null,
        status,
        priority,
        assignee: toStr(pickField(row, ["assignee", "assignedto", "owner", "responsible"])),
      };
    },
    onComplete: () => load(),
  });

  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);

  const cycleStatus = async (item: TodoItem) => {
    const idx = STATUS_CYCLE.indexOf(item.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: next } : i));
    try {
      const res = await fetch(`/api/todo-items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setErrorMsg(`Status update failed (${res.status})`);
        load();
      }
    } catch {
      setErrorMsg("Network error — could not update status.");
      load();
    }
  };

  const toggleDone = async (item: TodoItem) => {
    const next: TodoStatus = item.status === "done" ? "open" : "done";
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: next } : i));
    try {
      const res = await fetch(`/api/todo-items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) { setErrorMsg(`Update failed (${res.status})`); load(); }
    } catch {
      setErrorMsg("Network error — could not update.");
      load();
    }
  };

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (item: TodoItem) => {
    setEditId(item.id);
    setForm({
      title: item.title,
      notes: item.notes ?? "",
      due_date: item.due_date ?? "",
      status: item.status,
      priority: item.priority,
      assignee: item.assignee ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);
    const payload = {
      project_id: projectId,
      title:      form.title.trim(),
      notes:      form.notes || null,
      due_date:   form.due_date || null,
      status:     form.status,
      priority:   form.priority,
      assignee:   form.assignee || null,
    };
    try {
      const res = editId
        ? await fetch(`/api/todo-items/${encodeURIComponent(editId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/todo-items", {
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
    if (!(await confirm({ title: String("Delete this to-do?"), destructive: true }))) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/todo-items/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setErrorMsg(`Delete failed (${res.status}) — refreshing list.`);
        load();
      }
    } catch {
      setErrorMsg("Network error — could not delete.");
      load();
    }
  };

  const counts: Record<TodoStatus, number> = {
    open:        items.filter((i) => i.status === "open").length,
    in_progress: items.filter((i) => i.status === "in_progress").length,
    done:        items.filter((i) => i.status === "done").length,
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

      {/* Summary / filter */}
      <div className="grid grid-cols-3 gap-3">
        {(["open", "in_progress", "done"] as TodoStatus[]).map((s) => (
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
              : "text-[#CCFF00]"
            }`}>{counts[s]}</p>
          </button>
        ))}
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <CheckSquare size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">To-Do List</span>
            {filter !== "all" && (
              <span className="text-[9px] text-gray-700 uppercase tracking-widest">— {STATUS_LABELS[filter]}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton
              hint="todo"
              onParsed={importTodos}
              accept=".xlsx,.xls,.csv,.docx,.pdf"
            />
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              <Plus size={11} />
              Add Task
            </button>
          </div>
        </div>

        <div className="divide-y divide-white/5">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="px-4 py-3">
                <div className="h-3 bg-white/5 animate-pulse rounded w-1/2 mb-2" />
                <div className="h-2 bg-white/5 animate-pulse rounded w-1/3" />
              </div>
            ))
          ) : visible.length === 0 && !error ? (
            filter === "all" ? (
              <div className="py-4">
                <EmptyState
                  icon={<CheckSquare className="w-6 h-6" />}
                  title="No to-dos yet"
                  description="Track action items and follow-ups."
                  actionLabel="Add To-Do"
                  onAction={openAdd}
                />
              </div>
            ) : (
              <div className="text-center py-16">
                <span className="text-xs uppercase tracking-widest text-gray-600">
                  No {STATUS_LABELS[filter].toLowerCase()} tasks
                </span>
              </div>
            )
          ) : (
            visible.map((item) => {
              const isDone = item.status === "done";
              return (
                <div key={item.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleDone(item)}
                      className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isDone
                          ? "bg-[#CCFF00] border-[#CCFF00] text-black"
                          : "border-white/20 hover:border-[#CCFF00] hover:bg-[#CCFF00]/10"
                      }`}
                      aria-label={isDone ? "Mark not done" : "Mark done"}
                    >
                      {isDone && (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium ${isDone ? "text-gray-600 line-through" : "text-white"}`}>
                          {item.title}
                        </span>
                        <button
                          onClick={() => cycleStatus(item)}
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase cursor-pointer hover:opacity-80 transition-opacity ${STATUS_STYLES[item.status]}`}
                        >
                          {STATUS_LABELS[item.status]}
                        </button>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${PRIORITY_STYLES[item.priority]}`}>
                          {item.priority}
                        </span>
                      </div>
                      {(item.notes || item.due_date || item.assignee) && (
                        <div className="mt-1.5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-gray-600">
                          {item.due_date && <span>Due {fmtDate(item.due_date)}</span>}
                          {item.assignee && <span>· {item.assignee}</span>}
                          {item.notes && <span className="truncate normal-case tracking-normal text-gray-500 max-w-[260px]" title={item.notes}>{item.notes}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" aria-label="Edit task" onClick={() => openEdit(item)} className="min-h-[40px] text-gray-600 hover:text-white transition-colors" title="Edit">
                        <Pencil size={12} />
                      </button>
                      <button type="button" aria-label="Delete task" onClick={() => deleteItem(item.id)} className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors" title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">
            {editId ? "Edit Task" : "New Task"}
          </p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Title *</label>
                <input type="text" required value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={inputCls} placeholder="What needs to get done" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Due Date</label>
                <input type="date" value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  className={inputCls} />
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
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TodoStatus }))}
                  className={inputCls}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Assignee</label>
                <input type="text" value={form.assignee}
                  onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}
                  className={inputCls} placeholder="Name or role" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Notes</label>
                <textarea value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls + " min-h-[60px] resize-y"} placeholder="Optional details" />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving…" : editId ? "Save Changes" : "Add Task"}
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
