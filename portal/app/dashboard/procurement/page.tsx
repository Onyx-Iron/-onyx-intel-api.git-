"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Info, Truck } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import ProjectScopeSelect, { filterByActiveProject } from "@/components/project/ProjectScopeSelect";
import { useProjectContext } from "@/components/project/ProjectContext";

interface VendorBid {
  id: string;
  vendor_name: string;
  unit_price: number;
  status: string;
}

interface RequestItem {
  id: string;
  item_description: string;
  quantity: number;
  unit: string | null;
  status: string;
  bids: VendorBid[];
}

interface Batch {
  batch_id: string;
  batch_label: string | null;
  required_date: string | null;
  items: RequestItem[];
}

interface PurchaseOrder {
  id: string;
  project_id: string;
  po_number: number;
  total_amount: number;
  status: string;
  created_at: string | null;
}

interface Project {
  id: string;
  name: string;
}

const RFQ_STATUS_STYLES: Record<string, string> = {
  open: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  awarded: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  cancelled: "bg-white/5 text-white/40 border-white/10",
};

const PO_STATUS_STYLES: Record<string, string> = {
  draft: "bg-white/5 text-white/50 border-white/10",
  issued: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  closed: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
};

function currency(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function GlobalProcurementPage() {
  const { activeProjectId, activeProject, projects: contextProjects } = useProjectContext();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = activeProjectId ? `?project_id=${encodeURIComponent(activeProjectId)}` : "";
    Promise.all([
      fetch(`/api/procurement/requests${qs}`).then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ])
      .then(([procRes, projectsRes]: [unknown, unknown]) => {
        const proc = procRes as { batches?: Batch[]; purchase_orders?: PurchaseOrder[]; error?: string };
        const p = projectsRes as { projects?: Project[]; error?: string };
        if (proc.error) throw new Error(proc.error);
        if (p.error) throw new Error(p.error);
        setBatches(proc.batches ?? []);
        setPurchaseOrders(proc.purchase_orders ?? []);
        setProjects(p.projects ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  }, [activeProjectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects.length ? projects : contextProjects) m.set(p.id, p.name);
    return m;
  }, [projects, contextProjects]);

  const allItems = useMemo(() => batches.flatMap((b) => b.items.map((it) => ({ ...it, batch: b }))), [batches]);
  const filteredPurchaseOrders = useMemo(
    () => filterByActiveProject(purchaseOrders, activeProjectId),
    [purchaseOrders, activeProjectId],
  );

  const openWorkspaceHref = activeProject
    ? `/dashboard/projects/${activeProject.id}?phase=procurement&tab=procurement`
    : "/dashboard/projects";

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Procurement"
        description={
          activeProject
            ? `RFQs, bids, and POs for ${activeProject.name}`
            : "Every RFQ, vendor bid, and purchase order across all projects"
        }
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
            <Info size={12} className="shrink-0" />
            <span>
              Read-only roll-up. Package RFQs and award bids from a project&apos;s Procurement tab.
              {activeProject && (
                <>
                  {" "}
                  <Link href={openWorkspaceHref} className="text-[#CCFF00] hover:underline">
                    Open {activeProject.name} procurement
                  </Link>
                </>
              )}
            </span>
          </div>
          <ProjectScopeSelect className="w-56" label="" />
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">RFQ Line Items</h2>
          <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#0A0A0B] border-b border-white/10">
                  <tr>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Item</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Batch</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Quantity</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Bids</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-3 w-2/3 bg-white/5 animate-pulse rounded" /></td></tr>
                    ))
                  ) : allItems.length === 0 && !error ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="py-4">
                          <EmptyState icon={<Truck className="w-6 h-6" />} title="No RFQs yet" description="Package a quote request from a project's Procurement tab to see it roll up here." />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    allItems.map((item) => {
                      const key = item.status in RFQ_STATUS_STYLES ? item.status : "open";
                      return (
                        <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-white text-xs truncate max-w-xs">{item.item_description}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{item.batch.batch_label ?? "—"}</td>
                          <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{item.quantity} {item.unit ?? ""}</td>
                          <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{item.bids.length}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${RFQ_STATUS_STYLES[key]}`}>{item.status}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">Purchase Orders</h2>
          <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#0A0A0B] border-b border-white/10">
                  <tr>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">PO #</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Amount</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={i}><td colSpan={4} className="px-4 py-3"><div className="h-3 w-1/2 bg-white/5 animate-pulse rounded" /></td></tr>
                    ))
                  ) : filteredPurchaseOrders.length === 0 && !error ? (
                    <tr>
                      <td colSpan={4}>
                        <div className="py-4">
                          <EmptyState icon={<Truck className="w-6 h-6" />} title="No purchase orders yet" description="POs appear here once a vendor bid is awarded on a project." />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredPurchaseOrders.map((po) => {
                      const key = po.status in PO_STATUS_STYLES ? po.status : "draft";
                      return (
                        <tr key={po.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-white font-mono text-xs">PO-{po.po_number}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{projectNameById.get(po.project_id) ?? po.project_id}</td>
                          <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{currency(po.total_amount)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${PO_STATUS_STYLES[key]}`}>{po.status}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
