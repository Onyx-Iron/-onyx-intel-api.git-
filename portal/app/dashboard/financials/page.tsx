"use client";

import { useEffect, useMemo, useState } from "react";
import { DollarSign, Info } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";

interface Invoice {
  id: string;
  project_id: string;
  direction: "receivable" | "payable";
  vendor_or_customer: string;
  amount: number | null;
  status: string;
  due_date: string | null;
}

interface LienWaiver {
  id: string;
  project_id: string;
  vendor_name: string;
  waiver_type: string;
  amount: number | null;
  status: string;
}

interface Project {
  id: string;
  name: string;
}

const INVOICE_STATUS_STYLES: Record<string, string> = {
  open: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  paid: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  overdue: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  disputed: "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/20",
  canceled: "bg-white/5 text-white/40 border-white/10",
};

function currency(n: number | null): string {
  if (n == null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function GlobalFinancialsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [waivers, setWaivers] = useState<LienWaiver[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/invoices?limit=500").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ])
      .then(([invRes, projectsRes]: [unknown, unknown]) => {
        const inv = invRes as { items?: Invoice[]; error?: string };
        const p = projectsRes as { projects?: Project[]; error?: string };
        if (inv.error) throw new Error(inv.error);
        if (p.error) throw new Error(p.error);
        setInvoices(inv.items ?? []);
        setProjects(p.projects ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Could not load financials. Refresh the page and try again."); setLoading(false); });
  };

  const loadWaivers = () => {
    fetch("/api/lien-waivers")
      .then((r) => r.json())
      .then((d: { items?: LienWaiver[] }) => setWaivers(d.items ?? []))
      .catch(() => { /* non-critical secondary panel; main error banner covers invoices */ });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
      loadWaivers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const totals = useMemo(() => {
    const withAmount = invoices.filter((i) => i.amount != null);
    const receivable = withAmount.filter((i) => i.direction === "receivable" && i.status !== "paid" && i.status !== "canceled").reduce((s, i) => s + (i.amount ?? 0), 0);
    const payable = withAmount.filter((i) => i.direction === "payable" && i.status !== "paid" && i.status !== "canceled").reduce((s, i) => s + (i.amount ?? 0), 0);
    const anyRedacted = invoices.some((i) => i.amount == null);
    return { receivable, payable, anyRedacted };
  }, [invoices]);

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Financials"
        description="Invoices and lien waivers across all projects"
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-6 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
          <Info size={12} className="shrink-0" />
          <span>
            Use a project&apos;s Financials tab to add or update records, then review the totals here across all projects.
          </span>
        </div>

        {!loading && !error && invoices.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
              <p className="text-2xl font-black leading-none text-white">{totals.anyRedacted ? "-" : currency(totals.receivable)}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Open Accounts Receivable</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-[#111113] p-4">
              <p className="text-2xl font-black leading-none text-white">{totals.anyRedacted ? "-" : currency(totals.payable)}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Open Accounts Payable</p>
            </div>
          </div>
        )}

        <section className="mb-8">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">Invoices</h2>
          <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#0A0A0B] border-b border-white/10">
                  <tr>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Vendor / Customer</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Direction</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Amount</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-3 w-2/3 bg-white/5 animate-pulse rounded" /></td></tr>
                    ))
                  ) : invoices.length === 0 && !error ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="py-4">
                          <EmptyState
                            icon={<DollarSign className="w-6 h-6" />}
                            title="No invoices yet"
                            description="Add invoices in a project&apos;s Financials tab and they will appear here automatically for a workspace-wide view."
                            actionLabel="Open projects"
                            actionHref="/dashboard/projects"
                            secondaryLabel="Back to projects"
                            secondaryHref="/dashboard/projects"
                          />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => {
                      const key = inv.status in INVOICE_STATUS_STYLES ? inv.status : "open";
                      return (
                        <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-white text-xs truncate max-w-xs">{inv.vendor_or_customer}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{projectNameById.get(inv.project_id) ?? inv.project_id}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs capitalize">{inv.direction}</td>
                          <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{currency(inv.amount)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${INVOICE_STATUS_STYLES[key]}`}>{inv.status}</span>
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

        {waivers.length > 0 && (
          <section>
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">Lien Waivers</h2>
            <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0A0A0B] border-b border-white/10">
                    <tr>
                      <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Vendor</th>
                      <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                      <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Type</th>
                      <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Amount</th>
                      <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {waivers.map((w) => (
                      <tr key={w.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white text-xs">{w.vendor_name}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{projectNameById.get(w.project_id) ?? w.project_id}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{w.waiver_type.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{currency(w.amount)}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs capitalize">{w.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
