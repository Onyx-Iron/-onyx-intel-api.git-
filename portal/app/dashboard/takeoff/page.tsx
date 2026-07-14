"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Ruler } from "lucide-react";
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
  if (!d) return "—";
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
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

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

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Takeoff"
        description="Every takeoff item across all projects, in one roll-up view"
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
          <Info size={12} className="shrink-0" />
          <span>Read-only roll-up. Draw and edit takeoffs from a project&apos;s Takeoff tab.</span>
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
                          description="Draw takeoffs from a project's Takeoff tab to see them roll up here."
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
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.csi_code ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">
                          {item.quantity != null ? `${item.quantity} ${item.unit ?? ""}` : "—"}
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
      </div>
    </div>
  );
}
