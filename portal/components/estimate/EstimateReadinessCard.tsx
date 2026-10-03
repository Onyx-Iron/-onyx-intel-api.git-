"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReadinessCheck } from "@/lib/estimating/readiness";

export default function EstimateReadinessCard({ projectId }: { projectId: string }) {
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/estimate-readiness`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json() as { ready?: boolean; checks?: ReadinessCheck[] };
    setReady(Boolean(data.ready));
    setChecks(data.checks ?? []);
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 8000);
    window.addEventListener("onyx:documents-refresh", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("onyx:documents-refresh", load);
    };
  }, [load]);

  if (checks.length === 0) return null;

  return (
    <section className="mx-4 mt-4 rounded-xl border border-white/10 bg-[#16161A] px-4 py-3 sm:mx-6 lg:mx-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-white/70">Estimate readiness</h2>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${ready ? "text-[#CCFF00]" : "text-[#F5A623]"}`}>
          {ready ? "Ready to price" : "Blocked"}
        </span>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {checks.map((check) => (
          <li key={check.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
            <div className={`text-[10px] font-bold uppercase tracking-widest ${check.ok ? "text-[#CCFF00]" : "text-[#F5A623]"}`}>
              {check.ok ? "Ok" : "Needs work"} · {check.label}
            </div>
            <p className="mt-1 text-[11px] text-white/60">{check.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
