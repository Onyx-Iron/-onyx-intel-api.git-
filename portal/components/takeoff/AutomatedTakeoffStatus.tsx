"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

interface Job { id: string; state: string; created_at: string; scope_snapshot: { mode?: string } }

export default function AutomatedTakeoffStatus({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/takeoff/jobs?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setJobs(body.jobs ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const current = jobs[0];
  const completed = current?.state === "estimate_imported" || current?.state === "superseded";
  const attention = current && ["blocked", "conflicted", "failed_terminal"].includes(current.state);

  return (
    <section className="mb-5 rounded-xl border border-white/10 bg-[#0E0F12] p-4" aria-label="Automated takeoff status">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#00D2FF]">Automated takeoff status</p>
          <p className="mt-1 text-xs text-white/60">Completion is reported only after every in-scope unit is resolved and approved quantities are reconciled.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-full border border-white/10 p-2 text-white/50 hover:text-white" aria-label="Refresh takeoff status"><RefreshCw size={13} /></button>
      </div>
      {loading ? <p className="mt-3 flex items-center gap-2 text-xs text-white/45"><Loader2 size={13} className="animate-spin" />Checking workflow…</p>
        : error ? <p className="mt-3 flex items-center gap-2 text-xs text-red-300"><AlertTriangle size={13} />{error}</p>
          : !current ? <p className="mt-3 text-xs text-white/40">No governed automated run has started yet. Confirm scope, then select a document.</p>
            : <div className="mt-3 flex items-center gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 font-semibold uppercase tracking-wider ${completed ? "bg-[#CCFF00]/10 text-[#CCFF00]" : attention ? "bg-amber-400/10 text-amber-300" : "bg-[#00D2FF]/10 text-[#00D2FF]"}`}>{current.state.replaceAll("_", " ")}</span><span className="text-white/35">Scope: {current.scope_snapshot?.mode ?? "confirmed"}</span>{completed && <CheckCircle2 size={14} className="text-[#CCFF00]" />}</div>}
    </section>
  );
}
