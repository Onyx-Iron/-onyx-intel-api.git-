"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Info, Mountain } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import ProjectScopeSelect, { filterByActiveProject } from "@/components/project/ProjectScopeSelect";
import { useProjectContext } from "@/components/project/ProjectContext";
import { chooseOrCreateProjectHref } from "@/lib/navigation/project-sections";

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
  const { activeProjectId, activeProject } = useProjectContext();
  const [rows, setRows] = useState<VolumeRow[]>([]);
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
        const v = volRes as { items?: VolumeRow[]; error?: string };
        const p = projectsRes as { projects?: Project[]; error?: string };
        if (v.error) throw new Error(v.error);
        if (p.error) throw new Error(p.error);
        setRows(v.items ?? []);
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

  const filteredRows = useMemo(
    () => filterByActiveProject(rows, activeProjectId),
    [rows, activeProjectId],
  );

  const scopedTotals = useMemo(() => {
    if (filteredRows.length === 0) return null;
    return filteredRows.reduce(
      (acc, row) => ({
        cut_bcy: acc.cut_bcy + row.cut_volume_cy,
        fill_bcy: acc.fill_bcy + row.fill_volume_cy,
        net_bcy: acc.net_bcy + row.net_balance_cy,
      }),
      { cut_bcy: 0, fill_bcy: 0, net_bcy: 0 },
    );
  }, [filteredRows]);

  const openWorkspaceHref = chooseOrCreateProjectHref(activeProject?.id, "takeoff", "cutfill");
  const massHaulHref = activeProject
    ? `/dashboard/projects/${activeProject.id}/civil-earthwork`
    : null;

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Civil Intelligence"
        description={
          activeProject
            ? `Earthwork cut/fill volumes for ${activeProject.name}`
            : "Earthwork cut/fill volumes across all projects"
        }
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-6 flex flex-wrap items-start gap-3">
          <div className="flex flex-1 items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              Read-only roll-up of earthwork cut/fill volumes from each project&apos;s Cut/Fill tab.
              {activeProject && (
                <>
                  {" "}
                  <Link href={openWorkspaceHref} className="text-[#CCFF00] hover:underline">
                    Open {activeProject.name} cut/fill
                  </Link>
                  {massHaulHref && (
                    <>
                      {" · "}
                      <Link href={massHaulHref} className="text-[#CCFF00] hover:underline">
                        Mass haul matrix
                      </Link>
                    </>
                  )}
                </>
              )}
            </span>
          </div>
          <ProjectScopeSelect className="w-56" label="" />
        </div>

        {!loading && !error && scopedTotals && (
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
              <p className="text-2xl font-black leading-none text-white">{cy(scopedTotals.cut_bcy)}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Total Cut</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
              <p className="text-2xl font-black leading-none text-white">{cy(scopedTotals.fill_bcy)}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Total Fill</p>
            </div>
            <div className={`rounded-xl border p-4 ${scopedTotals.net_bcy !== 0 ? "border-[#F5A623]/30 bg-[#F5A623]/[0.04]" : "border-white/8 bg-[#111113]"}`}>
              <p className={`text-2xl font-black leading-none ${scopedTotals.net_bcy !== 0 ? "text-[#F5A623]" : "text-white"}`}>{cy(scopedTotals.net_bcy)}</p>
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
                ) : filteredRows.length === 0 && !error ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="py-4">
                        <EmptyState
                          icon={<Mountain className="w-6 h-6" />}
                          title="No earthwork volumes yet"
                          description="Civil intelligence starts in a project Cut/Fill tab."
                          actionLabel={activeProject ? "Open Cut / Fill" : "Choose or create a project"}
                          actionHref={openWorkspaceHref}
                        />
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
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
