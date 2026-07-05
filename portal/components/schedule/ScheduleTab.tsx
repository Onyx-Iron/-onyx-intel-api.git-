"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Calendar } from "lucide-react";
import GanttView from "./GanttView";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import { useBulkImport, toStr, toNum, toDate } from "@/components/common/useBulkImport";

import { useConfirm } from "@/components/common/ConfirmDialog";
import EmptyState from "@/components/common/EmptyState";

function pick(row: Record<string, string | number | null>, keys: string[]): string | null {
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

function toIsoDate(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

type TaskStatus = "not_started" | "in_progress" | "complete" | "blocked";

interface ScheduleTask {
  id: string;
  name: string;
  status: TaskStatus;
  start_date: string | null;
  end_date: string | null;
  critical: boolean;
}

interface FormState {
  name: string;
  status: TaskStatus;
  start_date: string;
  end_date: string;
  critical: boolean;
}

const STATUS_CYCLE: TaskStatus[] = ["not_started", "in_progress", "complete", "blocked"];

const STATUS_STYLES: Record<TaskStatus, string> = {
  not_started: "bg-white/5 text-gray-500 border-white/10",
  in_progress:  "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  complete:     "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  blocked:      "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

function statusLabel(s: TaskStatus): string {
  return s.replace("_", " ");
}

function daysBetween(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const diff = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
  return diff < 0 ? "—" : `${Math.round(diff)}d`;
}

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const EMPTY_FORM: FormState = {
  name: "",
  status: "not_started",
  start_date: "",
  end_date: "",
  critical: false,
};

function SkeletonRows() {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <tr key={i}>
          {[...Array(7)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "60%" : "40%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function ScheduleTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "timeline">("list");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadTasks = () => {
    setLoading(true);
    fetch(`/api/schedule?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { tasks?: ScheduleTask[] };
        setTasks(data.tasks ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadTasks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const importTasks = useBulkImport<{ project_id: string; name: string; status: TaskStatus; start_date: string | null; end_date: string | null; critical: boolean }>(projectId, {
    endpoint: "/api/schedule",
    mapRow: (row, pid) => {
      const name = toStr(pick(row, ["task", "name", "activity", "description", "title"]));
      if (!name) return null;
      const statusRaw = (toStr(pick(row, ["status", "state"])) ?? "").toLowerCase().replace(/[\s_-]/g, "");
      const status: TaskStatus =
        statusRaw.includes("progress") ? "in_progress" :
        statusRaw.includes("complete") || statusRaw === "done" ? "complete" :
        statusRaw.includes("block") ? "blocked" :
        "not_started";
      const criticalRaw = (toStr(pick(row, ["critical", "iscritical"])) ?? "").toLowerCase();
      return {
        project_id: pid,
        name,
        status,
        start_date: toDate(pick(row, ["start", "startdate", "begin", "from"])),
        end_date:   toDate(pick(row, ["end", "enddate", "finish", "to", "due", "duedate"])),
        critical:   criticalRaw === "true" || criticalRaw === "1" || criticalRaw === "yes",
      };
    },
    onComplete: () => loadTasks(),
  });

  const cycleStatus = async (task: ScheduleTask) => {
    const idx = STATUS_CYCLE.indexOf(task.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: next } : t));
    try {
      const res = await fetch(`/api/schedule/${encodeURIComponent(task.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof d?.error === "string" ? d.error : `Status update failed (${res.status})`);
        loadTasks();
      }
    } catch {
      setErrorMsg("Network error — could not update status.");
      loadTasks();
    }
  };

  const deleteTask = async (id: string) => {
    if (!(await confirm({ title: String("Delete this task?"), destructive: true }))) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/schedule/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof d?.error === "string" ? d.error : `Delete failed (${res.status})`);
        loadTasks();
      }
    } catch {
      setErrorMsg("Network error — could not delete task.");
      loadTasks();
    }
  };

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (task: ScheduleTask) => {
    setEditId(task.id);
    setForm({
      name: task.name,
      status: task.status,
      start_date: task.start_date ?? "",
      end_date: task.end_date ?? "",
      critical: task.critical,
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    const payload = {
      name: form.name.trim(),
      status: form.status,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      critical: form.critical,
      project_id: projectId,
    };
    try {
      setErrorMsg(null);
      const res = editId
        ? await fetch(`/api/schedule/${encodeURIComponent(editId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/schedule", {
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
      loadTasks();
    } catch {
      setErrorMsg("Network error — could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button onClick={() => setErrorMsg(null)} className="text-[10px] text-gray-500 hover:text-white uppercase tracking-widest">Dismiss</button>
        </div>
      )}
      {/* Panel */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <CalendarDays size={12} className="text-[#00D2FF]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Schedule</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {(["list", "timeline"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${
                    view === v ? "bg-[#00D2FF]/15 text-[#00D2FF]" : "text-gray-600 hover:text-gray-400"
                  }`}
                >
                  {v === "list" ? "List" : "Timeline"}
                </button>
              ))}
            </div>
            <UniversalImportButton
              hint="schedule"
              onParsed={importTasks}
              accept=".xlsx,.xls,.csv,.docx,.pdf"
            />
            <button
              onClick={openAdd}
              className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              Add Task
            </button>
          </div>
        </div>

        {/* Body — list or timeline */}
        {view === "timeline" ? (
          <div className="p-4">
            <GanttView tasks={tasks} />
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Name</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Status</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Start</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">End</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Duration</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Critical</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows />
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="py-4">
                      <EmptyState
                        icon={<Calendar className="w-6 h-6" />}
                        title="No tasks scheduled"
                        description="Add tasks to start building your project schedule."
                        actionLabel="Add Task"
                        onAction={openAdd}
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-white text-xs">{task.name}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => cycleStatus(task)}
                        className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase cursor-pointer hover:opacity-80 transition-opacity ${STATUS_STYLES[task.status]}`}
                      >
                        {statusLabel(task.status)}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmt(task.start_date)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmt(task.end_date)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">{daysBetween(task.start_date, task.end_date)}</td>
                    <td className="px-4 py-3">
                      {task.critical
                        ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#E50914]" title="Critical path" />
                        : <span className="text-gray-700 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEdit(task)}
                          aria-label="Edit task"
                          className="w-3.5 h-3.5 min-h-[40px] text-gray-600 hover:text-white transition-colors"
                          title="Edit"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteTask(task.id)}
                          aria-label="Delete task"
                          className="w-3.5 h-3.5 min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors"
                          title="Delete"
                        >
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
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">
            {editId ? "Edit Task" : "New Task"}
          </p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Task Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                  placeholder="e.g. Pour foundation slab"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="complete">Complete</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.critical}
                    onChange={(e) => setForm((f) => ({ ...f, critical: e.target.checked }))}
                    className="w-4 h-4 rounded accent-[#CCFF00]"
                  />
                  <span className="text-xs text-gray-400">Critical path task</span>
                </label>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
              >
                {submitting ? "Saving..." : editId ? "Save Changes" : "Add Task"}
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
