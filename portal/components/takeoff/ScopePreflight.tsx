"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import AIAccuracyNotice from "@/components/common/AIAccuracyNotice";

interface Division { code: string; name: string; family: string }
interface Props { projectId: string; onConfirmed?: (scopeId: string) => void }

export default function ScopePreflight({ projectId, onConfirmed }: Props) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [mode, setMode] = useState<"all_scopes" | "selected_trades">("selected_trades");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/construction-intelligence/scope?project_id=${encodeURIComponent(projectId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        setDivisions(body.divisions ?? []);
        if (body.latest?.id) {
          setConfirmedId(body.latest.id);
          setMode(body.latest.mode === "all_scopes" ? "all_scopes" : "selected_trades");
          setSelected(body.latest.division_codes ?? []);
          onConfirmed?.(body.latest.id);
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [projectId, onConfirmed]);

  const selectedLabels = useMemo(() => divisions.filter((division) => selected.includes(division.code)), [divisions, selected]);
  const toggle = (code: string) => setSelected((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);

  async function confirm() {
    if (mode === "selected_trades" && selected.length === 0) { setError("Select at least one trade division or choose complete all-scope analysis."); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/construction-intelligence/scope", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, mode, division_codes: mode === "all_scopes" ? [] : selected, trade_keys: [], bid_package_ids: [], document_ids: [], sheet_ids: [], alternate_keys: [] }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setConfirmedId(body.scope.id); onConfirmed?.(body.scope.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  }

  return (
    <section className="mb-5 rounded-xl border border-[#00D2FF]/20 bg-[#00D2FF]/[0.035] p-4" aria-label="Takeoff scope preflight">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#00D2FF]">Scope preflight</p>
          <h3 className="mt-1 text-sm font-semibold text-white">Choose what OnyxIntel should process</h3>
          <p className="mt-1 max-w-xl text-[11px] leading-5 text-white/45">Run every construction scope or limit takeoff to the trades you need. This selection is saved with the project for traceability and avoids unnecessary processing.</p>
        </div>
        {confirmedId && <span className="inline-flex items-center gap-1 rounded-full border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-[#CCFF00]"><Check size={11} /> Confirmed</span>}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setMode("all_scopes")} className={`rounded-lg border p-3 text-left transition-colors ${mode === "all_scopes" ? "border-[#CCFF00]/40 bg-[#CCFF00]/[0.06]" : "border-white/10 bg-black/20"}`}><p className="text-xs font-semibold text-white">Complete all-scope estimate</p><p className="mt-1 text-[10px] text-white/40">Analyze all active MasterFormat divisions and coordinate cross-trade scope.</p></button>
        <button type="button" onClick={() => setMode("selected_trades")} className={`rounded-lg border p-3 text-left transition-colors ${mode === "selected_trades" ? "border-[#CCFF00]/40 bg-[#CCFF00]/[0.06]" : "border-white/10 bg-black/20"}`}><p className="text-xs font-semibold text-white">Selected trades</p><p className="mt-1 text-[10px] text-white/40">Process only chosen divisions now; every other capability remains available later.</p></button>
      </div>
      {mode === "selected_trades" && (
        <details className="mt-3 rounded-lg border border-white/10 bg-black/20" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11px] font-semibold text-white/70">Trade divisions <span className="flex items-center gap-2 text-white/35">{selected.length} selected <ChevronDown size={13} /></span></summary>
          <div className="grid max-h-64 gap-1 overflow-y-auto border-t border-white/10 p-2 sm:grid-cols-2">
            {divisions.map((division) => <label key={division.code} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-white/[0.04]"><input type="checkbox" checked={selected.includes(division.code)} onChange={() => toggle(division.code)} className="mt-0.5 accent-[#CCFF00]" /><span><span className="block text-[11px] text-white/75">{division.code} — {division.name}</span><span className="text-[9px] uppercase tracking-wider text-white/30">{division.family}</span></span></label>)}
          </div>
        </details>
      )}
      {selectedLabels.length > 0 && mode === "selected_trades" && <p className="mt-2 text-[10px] text-white/35">Processing: {selectedLabels.map((division) => division.name).join(", ")}</p>}
      <AIAccuracyNotice context="takeoff" className="mt-3 rounded-lg" />
      {error && <p className="mt-3 text-[11px] text-[#FF6B6B]">{error}</p>}
      <button type="button" onClick={confirm} disabled={saving} className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-50">{saving && <Loader2 size={12} className="animate-spin" />}{confirmedId ? "Update processing scope" : "Confirm processing scope"}</button>
    </section>
  );
}
