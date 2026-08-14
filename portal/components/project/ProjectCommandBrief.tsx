"use client";

import { useState } from "react";

function parseProjectOpsBrief(input: string): {
  runAutopilot: boolean;
  importTakeoff: boolean;
  generateDocs: boolean;
} {
  const text = input.trim().toLowerCase();
  return {
    runAutopilot: /(autopilot|full|complete|everything|ops sweep|project sweep|do it all)/i.test(text),
    importTakeoff: /(takeoff|estimate|pricing|reprice|sync estimate|import)/i.test(text),
    generateDocs: /(document|docs|report|summary|risk|update|brief)/i.test(text),
  };
}

export default function ProjectCommandBrief({ projectId }: { projectId: string }) {
  const [brief, setBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [reviewHref, setReviewHref] = useState<string | null>(null);

  const runBrief = async () => {
    const text = brief.trim();
    if (running || !text) return;
    setErrorHint(null);
    setReviewHref(null);
    if (!projectId) {
      setResult("Pick a project first, then try the quick action again.");
      return;
    }
    setRunning(true);
    setResult("");
    try {
      const parsed = parseProjectOpsBrief(text);
      const steps: string[] = [];

      if (parsed.generateDocs) {
        for (const docType of ["project_update", "risk_assessment", "spec_materials"] as const) {
          const res = await fetch("/api/generated-docs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, doc_type: docType }),
          });
          const body = (await res.json().catch(() => ({}))) as { doc?: { title?: string }; error?: string };
          if (!res.ok || !body.doc) throw new Error(body.error ?? `Could not generate ${docType}. Check the project data and try again.`);
          steps.push(`Generated ${body.doc.title ?? docType}`);
        }
      }

      if (parsed.importTakeoff) {
        setReviewHref(`/dashboard/projects/${encodeURIComponent(projectId)}?phase=Takeoff&sub=takeoff`);
        steps.push("Takeoff review is ready; approve validated quantities there before estimate import");
      }

      if (parsed.runAutopilot) {
        const res = await fetch("/api/ai/risk-digest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          digest?: { risk_level?: string };
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? `Risk digest failed (${res.status}). Refresh the project summary and try again.`);
        steps.push(`Saved risk digest (${body.digest?.risk_level ?? "medium"})`);
      }

      if (steps.length === 0) {
        steps.push("No actions matched that yet. Try docs, takeoff, estimate, risk, or summary.");
        setErrorHint("Try asking for one or more of these: summary, docs, takeoff, estimate, or risk.");
      }

      setResult(steps.join(" | "));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult(message);
      setErrorHint(message.includes("No AI provider") ? "Open billing settings and connect an AI provider, then run it again." : "Try a smaller request or make sure the project already has the data you want to use.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/8 bg-[#111113] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Quick action</p>
          <p className="text-[11px] text-white/40">
            Describe the work in plain English. We will handle summaries, estimate sync, and risk updates when the
            words fit.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runBrief()}
          disabled={running || !brief.trim()}
          className="inline-flex h-9 items-center rounded-lg border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-3 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Running..." : "Run"}
        </button>
      </div>
      <textarea
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder="Example: Create the project summary, sync the estimate, and refresh the risk digest."
        className="min-h-[92px] w-full rounded-lg border border-white/10 bg-[#0A0A0B] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/50"
      />
      {result && <p className="mt-3 text-[11px] text-white/55">{result}</p>}
      {reviewHref && (
        <a
          href={reviewHref}
          className="mt-3 inline-flex h-8 items-center rounded-full border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-3 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/15"
        >
          Review takeoff quantities
        </a>
      )}
      {errorHint && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-white/45">
          <p>{errorHint}</p>
          {errorHint.includes("billing settings") && (
            <a
              href="/dashboard/settings/billing"
              className="mt-2 inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.03] px-3 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white"
            >
              Open billing settings
            </a>
          )}
        </div>
      )}
    </div>
  );
}
