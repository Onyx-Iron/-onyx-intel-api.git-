"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Plus, Sparkles, ChevronDown, ChevronRight, Trash2, Pencil } from "lucide-react";
import UniversalImportButton from "@/components/common/UniversalImportButton";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import { useBulkImport, toStr } from "@/components/common/useBulkImport";

import { useConfirm } from "@/components/common/ConfirmDialog";

interface WeeklyLog {
  id: string;
  week_start: string;
  week_end: string;
  schedule_status: string | null;
  budget_status: string | null;
  milestones_completed: string | null;
  upcoming_milestones: string | null;
  open_issues: string | null;
  decisions_needed: string | null;
  summary: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  week_start: string;
  week_end: string;
  schedule_status: string;
  budget_status: string;
  milestones_completed: string;
  upcoming_milestones: string;
  open_issues: string;
  decisions_needed: string;
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

function toISODate(value: string): string {
  // Accept YYYY-MM-DD or anything Date parses
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0]!;
}

function startOfWeek(d: Date): Date {
  // Monday-start week
  const out = new Date(d);
  const day = out.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function thisWeekRange(): { start: string; end: string } {
  const now = new Date();
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: start.toISOString().split("T")[0]!, end: end.toISOString().split("T")[0]! };
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRange(start: string, end: string): string {
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

const EMPTY_FORM: FormState = {
  week_start: "", week_end: "",
  schedule_status: "", budget_status: "",
  milestones_completed: "", upcoming_milestones: "",
  open_issues: "", decisions_needed: "",
};

export default function WeeklyLogTab({ projectId }: { projectId: string }) {
  const { confirm } = useConfirm();
  const [logs, setLogs] = useState<WeeklyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/weekly-logs?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: { logs?: WeeklyLog[] }) => {
        setLogs(d.logs ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const importLogs = useBulkImport<{
    project_id: string; week_start: string; week_end: string;
    schedule_status: string | null; budget_status: string | null;
    milestones_completed: string | null; open_issues: string | null;
  }>(projectId, {
    endpoint: "/api/weekly-logs",
    mapRow: (row, pid) => {
      const ws = toStr(pickField(row, ["weekstart", "weekstartdate", "startdate", "weekstarting", "start"]));
      const we = toStr(pickField(row, ["weekend", "weekenddate", "enddate", "weekending", "end"]));
      if (!ws || !we) return null;
      return {
        project_id: pid,
        week_start: toISODate(ws),
        week_end: toISODate(we),
        schedule_status: toStr(pickField(row, ["schedulestatus", "schedule"])),
        budget_status: toStr(pickField(row, ["budgetstatus", "budget"])),
        milestones_completed: toStr(pickField(row, ["milestonescompleted", "completedmilestones", "milestones"])),
        open_issues: toStr(pickField(row, ["openissues", "issues", "risks"])),
      };
    },
    onComplete: () => load(),
  });

  const openAdd = (preset?: { start: string; end: string }) => {
    setEditId(null);
    setForm({ ...EMPTY_FORM, week_start: preset?.start ?? "", week_end: preset?.end ?? "" });
    setShowForm(true);
  };

  const openEdit = (log: WeeklyLog) => {
    setEditId(log.id);
    setForm({
      week_start: log.week_start,
      week_end: log.week_end,
      schedule_status: log.schedule_status ?? "",
      budget_status: log.budget_status ?? "",
      milestones_completed: log.milestones_completed ?? "",
      upcoming_milestones: log.upcoming_milestones ?? "",
      open_issues: log.open_issues ?? "",
      decisions_needed: log.decisions_needed ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.week_start || !form.week_end) {
      setErrorMsg("Week start and week end are required.");
      return;
    }
    if (form.week_end < form.week_start) {
      setErrorMsg("Week end must be on or after week start.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    const payload = {
      project_id:           projectId,
      week_start:           form.week_start,
      week_end:             form.week_end,
      schedule_status:      form.schedule_status || null,
      budget_status:        form.budget_status || null,
      milestones_completed: form.milestones_completed || null,
      upcoming_milestones:  form.upcoming_milestones || null,
      open_issues:          form.open_issues || null,
      decisions_needed:     form.decisions_needed || null,
    };
    try {
      const res = editId
        ? await fetch(`/api/weekly-logs/${encodeURIComponent(editId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/weekly-logs", {
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

  const generateThisWeek = async () => {
    setErrorMsg(null);
    const { start, end } = thisWeekRange();
    const existing = logs.find((l) => l.week_start === start);
    let targetId = existing?.id;

    if (!targetId) {
      const createRes = await fetch("/api/weekly-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, week_start: start, week_end: end }),
      });
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `Create failed (${createRes.status})`);
        return;
      }
      const j = await createRes.json() as { log?: { id?: string } };
      targetId = j.log?.id;
    }
    if (!targetId) { setErrorMsg("Could not resolve weekly log id."); return; }
    await runGenerate(targetId);
  };

  const runGenerate = async (id: string) => {
    setGeneratingId(id);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/weekly-logs/${encodeURIComponent(id)}/generate`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(typeof (d as { error?: unknown })?.error === "string" ? (d as { error: string }).error : `AI generation failed (${res.status})`);
        return;
      }
      setExpanded((e) => ({ ...e, [id]: true }));
      load();
    } catch {
      setErrorMsg("Network error during AI generation.");
    } finally {
      setGeneratingId(null);
    }
  };

  const deleteLog = async (id: string) => {
    if (!(await confirm({ title: String("Delete this weekly log?"), destructive: true }))) return;
    setLogs((prev) => prev.filter((l) => l.id !== id));
    try {
      const res = await fetch(`/api/weekly-logs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setErrorMsg(`Delete failed (${res.status}) — refreshing list.`);
        load();
      }
    } catch {
      setErrorMsg("Network error — could not delete.");
      load();
    }
  };

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#CCFF00]/40 transition-colors";
  const textareaCls = inputCls + " min-h-[70px] resize-y";

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest">{errorMsg}</p>
          <button type="button" onClick={() => setErrorMsg(null)} className="min-h-[40px] text-[10px] text-gray-500 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">Dismiss</button>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <CalendarDays size={12} className="text-[#CCFF00]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Weekly Logs</span>
            <span className="text-[9px] text-gray-700 uppercase tracking-widest">— {logs.length} report{logs.length === 1 ? "" : "s"}</span>
          </div>
          <div className="flex items-center gap-2">
            <UniversalImportButton
              hint="weekly"
              onParsed={importLogs}
              accept=".xlsx,.xls,.csv,.docx,.pdf"
            />
            <button
              onClick={generateThisWeek}
              disabled={generatingId !== null}
              className="flex items-center gap-1.5 bg-[#00D2FF]/10 border border-[#00D2FF]/30 text-[#00D2FF] hover:bg-[#00D2FF]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
            >
              <Sparkles size={11} />
              {generatingId ? "Generating…" : "Generate This Week"}
            </button>
            <button
              onClick={() => openAdd(thisWeekRange())}
              className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              <Plus size={11} />
              New Week
            </button>
          </div>
        </div>

        <div className="divide-y divide-white/5">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-3 bg-white/5 animate-pulse rounded w-1/3 mb-2" />
                <div className="h-2 bg-white/5 animate-pulse rounded w-1/2" />
              </div>
            ))
          ) : logs.length === 0 && !error ? (
            <div className="py-4">
              <EmptyState
                icon={<CalendarDays className="w-6 h-6" />}
                title="No weekly logs yet"
                description="Roll up daily logs into a weekly summary for owners and stakeholders."
                actionLabel="New Weekly Log"
                onAction={() => openAdd(thisWeekRange())}
              />
            </div>
          ) : (
            logs.map((log) => {
              const isOpen = !!expanded[log.id];
              return (
                <div key={log.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => setExpanded((e) => ({ ...e, [log.id]: !isOpen }))}
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                    >
                      {isOpen ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                      <span className="text-white text-xs font-medium">{fmtRange(log.week_start, log.week_end)}</span>
                      {log.summary ? (
                        <span className="text-[9px] uppercase tracking-widest text-[#CCFF00] border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-2 py-0.5 rounded">AI</span>
                      ) : (
                        <span className="text-[9px] uppercase tracking-widest text-gray-600 border border-white/10 bg-white/5 px-2 py-0.5 rounded">Draft</span>
                      )}
                    </button>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => runGenerate(log.id)}
                        disabled={generatingId === log.id}
                        className="text-[10px] uppercase tracking-widest text-[#00D2FF] hover:text-white transition-colors disabled:opacity-50"
                        title="Regenerate AI summary"
                      >
                        {generatingId === log.id ? "…" : "Generate"}
                      </button>
                      <button type="button" aria-label="Edit weekly log" onClick={() => openEdit(log)} className="min-h-[40px] text-gray-600 hover:text-white transition-colors" title="Edit">
                        <Pencil size={12} />
                      </button>
                      <button type="button" aria-label="Delete weekly log" onClick={() => deleteLog(log.id)} className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors" title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 ml-5 space-y-3">
                      {log.summary ? (
                        <div className="rounded-lg border border-[#CCFF00]/20 bg-[#CCFF00]/[0.03] p-4">
                          <p className="text-[9px] uppercase tracking-widest text-[#CCFF00] mb-2">
                            AI Summary {log.generated_at ? `· ${new Date(log.generated_at).toLocaleString()}` : ""}
                          </p>
                          <pre className="whitespace-pre-wrap text-xs text-gray-300 font-sans leading-relaxed">{log.summary}</pre>
                        </div>
                      ) : (
                        <p className="text-[10px] uppercase tracking-widest text-gray-600">No AI summary yet — click Generate.</p>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        {log.schedule_status && (
                          <Field label="Schedule" value={log.schedule_status} />
                        )}
                        {log.budget_status && (
                          <Field label="Budget" value={log.budget_status} />
                        )}
                        {log.milestones_completed && (
                          <Field label="Milestones Completed" value={log.milestones_completed} />
                        )}
                        {log.upcoming_milestones && (
                          <Field label="Upcoming Milestones" value={log.upcoming_milestones} />
                        )}
                        {log.open_issues && (
                          <Field label="Open Issues" value={log.open_issues} />
                        )}
                        {log.decisions_needed && (
                          <Field label="Decisions Needed" value={log.decisions_needed} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">
            {editId ? "Edit Weekly Log" : "New Weekly Log"}
          </p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Week Start *</label>
                <input type="date" required value={form.week_start}
                  onChange={(e) => setForm((f) => ({ ...f, week_start: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Week End *</label>
                <input type="date" required value={form.week_end}
                  onChange={(e) => setForm((f) => ({ ...f, week_end: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Schedule Status</label>
                <textarea value={form.schedule_status}
                  onChange={(e) => setForm((f) => ({ ...f, schedule_status: e.target.value }))}
                  className={textareaCls} placeholder="On track / behind / ahead — brief note" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Budget Status</label>
                <textarea value={form.budget_status}
                  onChange={(e) => setForm((f) => ({ ...f, budget_status: e.target.value }))}
                  className={textareaCls} placeholder="Spend vs. budget" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Milestones Completed</label>
                <textarea value={form.milestones_completed}
                  onChange={(e) => setForm((f) => ({ ...f, milestones_completed: e.target.value }))}
                  className={textareaCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Upcoming Milestones</label>
                <textarea value={form.upcoming_milestones}
                  onChange={(e) => setForm((f) => ({ ...f, upcoming_milestones: e.target.value }))}
                  className={textareaCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Open Issues</label>
                <textarea value={form.open_issues}
                  onChange={(e) => setForm((f) => ({ ...f, open_issues: e.target.value }))}
                  className={textareaCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Decisions Needed</label>
                <textarea value={form.decisions_needed}
                  onChange={(e) => setForm((f) => ({ ...f, decisions_needed: e.target.value }))}
                  className={textareaCls} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Saving…" : editId ? "Save Changes" : "Create Week"}
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1">{label}</p>
      <p className="text-gray-300 whitespace-pre-wrap">{value}</p>
    </div>
  );
}
