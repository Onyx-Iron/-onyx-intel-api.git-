"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Mountain } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";

interface VolumeRow {
  id: string;
  project_id: string;
  layer_name: string;
  cut_volume_cy: number;
  fill_volume_cy: number;
  net_balance_cy: number;
}

interface Project {
  id: string;
  name: string;
}

function cy(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} CY`;
}

export default function GlobalCivilIntelligencePage() {
  const [rows, setRows] = useState<VolumeRow[]>([]);
  const [totals, setTotals] = useState<{ cut_bcy: number; fill_bcy: number; net_bcy: number } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/earthwork/volumes").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ])
      .then(([volRes, projectsRes]: [unknown, unknown]) => {
        const v = volRes as { items?: VolumeRow[]; totals?: { cut_bcy: number; fill_bcy: number; net_bcy: number }; error?: string };
        const p = projectsRes as { projects?: Project[]; error?: string };
        if (v.error) throw new Error(v.error);
        if (p.error) throw new Error(p.error);
        setRows(v.items ?? []);
        setTotals(v.totals ?? null);
        setProjects(p.projects ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Civil Intelligence"
        description="Earthwork cut/fill volumes across all projects"
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-6 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>
            Read-only roll-up of earthwork cut/fill/mass-haul volumes, sourced from each project&apos;s Civil scope panel.
            Utility pipe runs, construction entrances, stockpiles, and material ledger entries are project-level only for
            now — see the Cut/Fill tab inside a project&apos;s Takeoff section for that detail.
          </span>
        </div>

        {!loading && !error && totals && (
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
              <p className="text-2xl font-black leading-none text-white">{cy(totals.cut_bcy)}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Total Cut</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
              <p className="text-2xl font-black leading-none text-white">{cy(totals.fill_bcy)}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Total Fill</p>
            </div>
            <div className={`rounded-xl border p-4 ${totals.net_bcy !== 0 ? "border-[#F5A623]/30 bg-[#F5A623]/[0.04]" : "border-white/8 bg-[#111113]"}`}>
              <p className={`text-2xl font-black leading-none ${totals.net_bcy !== 0 ? "text-[#F5A623]" : "text-white"}`}>{cy(totals.net_bcy)}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Net Balance</p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#0A0A0B] border-b border-white/10">
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Layer</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Cut</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Fill</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-3 w-2/3 bg-white/5 animate-pulse rounded" /></td></tr>
                  ))
                ) : rows.length === 0 && !error ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="py-4">
                        <EmptyState icon={<Mountain className="w-6 h-6" />} title="No earthwork volumes yet" description="Compute cut/fill volumes from a project's Cut/Fill tab to see them roll up here." />
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-white text-xs">{row.layer_name}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{projectNameById.get(row.project_id) ?? row.project_id}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{cy(row.cut_volume_cy)}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{cy(row.fill_volume_cy)}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{cy(row.net_balance_cy)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
