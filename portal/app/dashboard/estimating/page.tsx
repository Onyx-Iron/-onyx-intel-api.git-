"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Info } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";

interface EstimateItem {
  id: string;
  project_id: string;
  description: string;
  trade: string | null;
  csi_code: string | null;
  quantity: number | null;
  uom: string | null;
  total_price: number | null;
  pricing_status: string | null;
  created_at: string | null;
}

interface Project {
  id: string;
  name: string;
}

const PRICING_STYLES: Record<string, string> = {
  manual: "bg-white/5 text-white/60 border-white/10",
  priced: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  unpriced: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  review: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
};

function currency(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

export default function GlobalEstimatingPage() {
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/estimate?limit=500").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ])
      .then(([estimateRes, projectsRes]: [unknown, unknown]) => {
        const e = estimateRes as { items?: EstimateItem[]; error?: string };
        const p = projectsRes as { projects?: Project[]; error?: string };
        if (e.error) throw new Error(e.error);
        if (p.error) throw new Error(p.error);
        setItems(e.items ?? []);
        setProjects(p.projects ?? []);
        setLoading(false);
      })
      .catch((err) => { setError(err?.message ?? "Network error"); setLoading(false); });
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

  // total_price may be redacted (null) for restricted roles by the API's
  // financial-read gate -- sum only what's actually present, and show a
  // dash for the aggregate too rather than a misleading partial total.
  const grandTotal = useMemo(() => {
    if (items.some((i) => i.total_price == null)) return null;
    return items.reduce((sum, i) => sum + (i.total_price ?? 0), 0);
  }, [items]);

  const pricingCounts = useMemo(() => ({
    unpriced: items.filter((i) => i.pricing_status === "unpriced").length,
    review: items.filter((i) => i.pricing_status === "review").length,
  }), [items]);

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Estimating"
        description="Every estimate line item across all projects, in one roll-up view"
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
          <Info size={12} className="shrink-0" />
          <span>Read-only roll-up. Build and price estimates from a project&apos;s Estimate tab. Cost/price fields are hidden here for roles without financial access.</span>
        </div>

        {!loading && !error && items.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-white/10 bg-[#0E0F12] px-4 py-2">
              <p className="text-[9px] uppercase tracking-widest text-white/40">Total value</p>
              <p className="font-mono text-sm text-white">{grandTotal != null ? currency(grandTotal) : "—"}</p>
            </div>
            <div className="rounded-lg border border-[#E50914]/20 bg-[#E50914]/10 px-4 py-2">
              <p className="text-[9px] uppercase tracking-widest text-[#E50914]/80">Unpriced</p>
              <p className="font-mono text-sm text-white">{pricingCounts.unpriced}</p>
            </div>
            <div className="rounded-lg border border-[#00D2FF]/20 bg-[#00D2FF]/10 px-4 py-2">
              <p className="text-[9px] uppercase tracking-widest text-[#00D2FF]/80">Needs review</p>
              <p className="font-mono text-sm text-white">{pricingCounts.review}</p>
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
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Description</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Trade</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Quantity</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Total</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Pricing</th>
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
                          icon={<Calculator className="w-6 h-6" />}
                          title="No estimate items yet"
                          description="Build estimates from a project's Estimate tab to see them roll up here."
                        />
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const pricingKey = item.pricing_status && item.pricing_status in PRICING_STYLES ? item.pricing_status : "manual";
                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white text-xs truncate max-w-xs">{item.description}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{projectNameById.get(item.project_id) ?? item.project_id}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{item.trade ?? item.csi_code ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">
                          {item.quantity != null ? `${item.quantity} ${item.uom ?? ""}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{currency(item.total_price)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${PRICING_STYLES[pricingKey]}`}>
                            {item.pricing_status ?? "manual"}
                          </span>
                        </td>
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
