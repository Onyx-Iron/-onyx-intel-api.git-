"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Layers, Info, Ruler } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";

interface TakeoffItem {
  id: string;
  project_id: string;
  label: string | null;
  type: string;
  quantity: number | null;
  unit: string | null;
  csi_code: string | null;
  review_status: string | null;
  source_method: string | null;
  created_at: string | null;
}

interface Project {
  id: string;
  name: string;
}

const REVIEW_STYLES: Record<string, string> = {
  suggested: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  reviewed: "bg-white/5 text-white/60 border-white/10",
  approved: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  rejected: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

function fmt(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SkeletonRows() {
  return (
    <>
      {[...Array(6)].map((_, i) => (
        <tr key={i}>
          {[...Array(6)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "60%" : "40%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function GlobalTakeoffPage() {
  const [items, setItems] = useState<TakeoffItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/takeoff/items?limit=500").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ])
      .then(([takeoffRes, projectsRes]: [unknown, unknown]) => {
        const t = takeoffRes as { items?: TakeoffItem[]; error?: string };
        const p = projectsRes as { projects?: Project[]; error?: string };
        if (t.error) throw new Error(t.error);
        if (p.error) throw new Error(p.error);
        setItems(t.items ?? []);
        setProjects(p.projects ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Could not load takeoff items. Refresh the page and try again."); setLoading(false); });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const filtered = useMemo(() => {
    if (projectFilter === "all") return items;
    return items.filter((i) => i.project_id === projectFilter);
  }, [items, projectFilter]);

  const totals = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const i of items) {
      const key = i.review_status ?? "unknown";
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    return byStatus;
  }, [items]);

  const projectTakeoffCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items) {
      m.set(item.project_id, (m.get(item.project_id) ?? 0) + 1);
    }
    return m;
  }, [items]);

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Takeoff"
        description="Takeoff items across all projects in one place."
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-4 text-xs text-white/55">
            <div className="flex items-start gap-2">
              <Info size={12} className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p>Open a project to draw on sheets, edit items, and work sheet by sheet.</p>
                <p className="text-white/35">Use this page to review totals, then jump into a project when you want to draw or edit measurements.</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-[#CCFF00]/20 bg-[#CCFF00]/[0.05] px-4 py-4 text-xs text-white/70">
            <div className="flex items-center gap-2">
              <Layers size={12} className="text-[#CCFF00]" />
              <span className="font-semibold text-white">Fast path:</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 font-mono uppercase tracking-widest text-[10px]">Open project</span>
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 font-mono uppercase tracking-widest text-[10px]">Open Takeoff</span>
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 font-mono uppercase tracking-widest text-[10px]">Pick a sheet</span>
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 font-mono uppercase tracking-widest text-[10px]">Start measuring</span>
            </div>
          </div>
        </div>

        {!loading && !error && items.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(totals).map(([status, count]) => (
                <span
                  key={status}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${REVIEW_STYLES[status] ?? "bg-white/5 text-white/50 border-white/10"}`}
                >
                  {status}: {count}
                </span>
              ))}
            </div>
            <div className="ml-auto">
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#0E0F12] px-3 py-1.5 text-xs text-white/70 focus:border-[#CCFF00]/40 focus:outline-none"
              >
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#0A0A0B] border-b border-white/10">
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Item</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">CSI Code</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Quantity</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Review</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <SkeletonRows />
                ) : filtered.length === 0 && !error ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="py-4">
                        <EmptyState
                          icon={<Ruler className="w-6 h-6" />}
                          title="No takeoff items yet"
                          description="Create takeoffs in a project and they will appear here automatically."
                          actionLabel="Open projects"
                          actionHref="/dashboard/projects"
                          secondaryLabel="Open takeoff"
                          secondaryHref="/dashboard/takeoff"
                        />
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const reviewKey = item.review_status && item.review_status in REVIEW_STYLES ? item.review_status : "unknown";
                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white text-xs truncate max-w-xs">{item.label ?? "Untitled item"}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{projectNameById.get(item.project_id) ?? item.project_id}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.csi_code ?? "-"}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">
                          {item.quantity != null ? `${item.quantity} ${item.unit ?? ""}` : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${REVIEW_STYLES[reviewKey] ?? "bg-white/5 text-white/40 border-white/10"}`}>
                            {item.review_status ?? "unknown"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{fmt(item.created_at)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {projects.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Project shortcuts</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Open a project and go straight to Takeoff</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => (
                <div key={p.id} className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{p.name}</p>
                      <p className="mt-1 text-[11px] text-white/40">
                        {projectTakeoffCounts.get(p.id) ?? 0} takeoff item{(projectTakeoffCounts.get(p.id) ?? 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] uppercase tracking-widest text-white/40">
                      Project
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                      <Link
                        href={`/dashboard/projects/${p.id}?phase=Takeoff&sub=takeoff`}
                        className="inline-flex items-center gap-1 rounded-full bg-[#CCFF00] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
                      >
                        Open Takeoff <ArrowRight size={12} />
                      </Link>
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/25 hover:text-white"
                    >
                      Open Project
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
