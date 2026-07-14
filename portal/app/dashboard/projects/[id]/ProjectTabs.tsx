"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Award,
  Banknote,
  CalendarDays,
  Calculator,
  ClipboardList,
  Coins,
  FileCheck,
  FileStack,
  FileText,
  Hammer,
  HardHat,
  Layers,
  LayoutGrid,
  ListChecks,
  PackageOpen,
  Receipt,
  ShieldCheck,
  Truck,
} from "lucide-react";
import type { JSX } from "react";
import { printDocument } from "@/lib/print";
import TakeoffTab               from "@/components/takeoff/TakeoffTab";
import ScheduleTab              from "@/components/schedule/ScheduleTab";
import EstimateTab              from "@/components/estimate/EstimateTab";
import ProjectControlsTab       from "@/components/project-controls/ProjectControlsTab";
import PunchListTab             from "@/components/punchlist/PunchListTab";
import DocumentsTab             from "@/components/documents/DocumentsTab";
import DailyLogTab              from "@/components/dailylog/DailyLogTab";
import ContactsTab              from "@/components/contacts/ContactsTab";
import RiskDigestCard           from "@/components/project/RiskDigestCard";
import MaterialVendorsTab       from "@/components/material-vendors/MaterialVendorsTab";
import EquipmentSuppliersTab    from "@/components/equipment-suppliers/EquipmentSuppliersTab";
import StaffTab                 from "@/components/staff/StaffTab";
import WeeklyLogTab             from "@/components/weekly-log/WeeklyLogTab";
import TodoTab                  from "@/components/todo/TodoTab";
import CertificateOfOccupancyTab from "@/components/cert-occupancy/CertificateOfOccupancyTab";
import AccountsReceivableTab    from "@/components/invoicing/AccountsReceivableTab";
import AccountsPayableTab       from "@/components/invoicing/AccountsPayableTab";
import OpenInvoicesTab          from "@/components/invoicing/OpenInvoicesTab";
import ClosedInvoicesTab        from "@/components/invoicing/ClosedInvoicesTab";
import LienWaiversTab           from "@/components/invoicing/LienWaiversTab";
import CutFillTab               from "@/components/cut-fill/CutFillTab";
import ProcurementBoard         from "@/components/procurement/ProcurementBoard";

// Target 10-section IA (docs/frontend-backend-reconciliation/INFORMATION_ARCHITECTURE.md)
// replacing the prior 5-phase/~21-subtab structure. This recomposes the same
// existing *Tab.tsx components into fewer top-level sections -- none of the
// underlying tab components were rewritten, only regrouped.
type Phase =
  | "Overview"
  | "Documents"
  | "Takeoff"
  | "Estimate & Budget"
  | "Schedule"
  | "Project Controls"
  | "Procurement"
  | "Financials"
  | "Field"
  | "Closeout";

interface SubTabDef {
  id: string;
  label: string;
  icon: JSX.Element;
  render: (projectId: string, projectName: string) => JSX.Element;
}

const PHASES: { id: Phase; subtabs: SubTabDef[] }[] = [
  {
    id: "Overview",
    subtabs: [
      { id: "summary", label: "Summary",         icon: <LayoutGrid size={13} />,    render: (p) => <OverviewTab projectId={p} /> },
      { id: "risk",    label: "Risk Assessment", icon: <AlertTriangle size={13} />, render: (p) => <RiskAssessmentTab projectId={p} /> },
    ],
  },
  {
    id: "Documents",
    subtabs: [
      { id: "documents", label: "Documents", icon: <FileText size={13} />, render: (p) => <DocumentsTab projectId={p} /> },
    ],
  },
  {
    id: "Takeoff",
    subtabs: [
      { id: "takeoff", label: "Takeoff",    icon: <Layers size={13} />, render: (p) => <TakeoffTab projectId={p} /> },
      { id: "cutfill", label: "Cut / Fill", icon: <Layers size={13} />, render: (p) => <CutFillTab projectId={p} /> },
    ],
  },
  {
    id: "Estimate & Budget",
    subtabs: [
      { id: "estimates", label: "Estimate & Budget", icon: <Calculator size={13} />, render: (p) => <EstimateTab projectId={p} /> },
    ],
  },
  {
    id: "Schedule",
    subtabs: [
      { id: "scheduling", label: "Schedule", icon: <CalendarDays size={13} />, render: (p) => <ScheduleTab projectId={p} /> },
    ],
  },
  {
    id: "Project Controls",
    subtabs: [
      // ProjectControlsTab already covers RFIs, Submittals, and Change
      // Orders in one component -- see item 3 of this reconciliation
      // (confirmed live and working, not the "broken" state Phase 1
      // originally mischaracterized it as).
      { id: "controls", label: "RFIs, Submittals & Change Orders", icon: <FileStack size={13} />, render: (p) => <ProjectControlsTab projectId={p} /> },
    ],
  },
  {
    id: "Procurement",
    subtabs: [
      // Wired in per frontend-backend-reconciliation Phase-1 audit finding:
      // ProcurementBoard + its full RFQ -> vendor bid -> award -> PO backend
      // already existed at this route with zero navigation path to it.
      { id: "procurement", label: "Vendor Bids & POs",     icon: <Truck size={13} />,       render: (p, n) => <ProcurementBoard projectId={p} projectName={n} /> },
      { id: "materials",   label: "Material Vendors",      icon: <PackageOpen size={13} />, render: (p) => <MaterialVendorsTab projectId={p} /> },
      { id: "equipment",   label: "Equipment Suppliers",   icon: <Truck size={13} />,       render: (p) => <EquipmentSuppliersTab projectId={p} /> },
      { id: "subs",        label: "Subcontractors",        icon: <Hammer size={13} />,      render: (p) => <ContactsTab projectId={p} /> },
    ],
  },
  {
    id: "Financials",
    subtabs: [
      { id: "ar",           label: "Accounts Receivable", icon: <Banknote size={13} />,    render: (p) => <AccountsReceivableTab projectId={p} /> },
      { id: "ap",           label: "Accounts Payable",    icon: <Receipt size={13} />,     render: (p) => <AccountsPayableTab projectId={p} /> },
      { id: "open",         label: "Open Invoices",       icon: <Coins size={13} />,       render: (p) => <OpenInvoicesTab projectId={p} /> },
      { id: "closed",       label: "Closed Invoices",     icon: <FileCheck size={13} />,   render: (p) => <ClosedInvoicesTab projectId={p} /> },
      { id: "lien-waivers", label: "Lien Waivers",        icon: <ShieldCheck size={13} />, render: (p) => <LienWaiversTab projectId={p} /> },
    ],
  },
  {
    id: "Field",
    subtabs: [
      { id: "daily-log",  label: "Daily Log",  icon: <ClipboardList size={13} />, render: (p) => <DailyLogTab projectId={p} /> },
      { id: "weekly-log", label: "Weekly Log", icon: <FileText size={13} />,      render: (p) => <WeeklyLogTab projectId={p} /> },
      { id: "todo",       label: "To Do List", icon: <ListChecks size={13} />,    render: (p) => <TodoTab projectId={p} /> },
      { id: "staff",      label: "Staff",      icon: <HardHat size={13} />,       render: (p) => <StaffTab projectId={p} /> },
    ],
  },
  {
    id: "Closeout",
    subtabs: [
      { id: "punchlist",  label: "Punchlist",                icon: <ListChecks size={13} />, render: (p) => <PunchListTab projectId={p} /> },
      { id: "co",         label: "Certificate of Occupancy", icon: <Award size={13} />,      render: (p) => <CertificateOfOccupancyTab projectId={p} /> },
      { id: "final-docs", label: "Final Docs",               icon: <FileText size={13} />,   render: (p) => <DocumentsTab projectId={p} /> },
    ],
  },
];

interface ProjectTabsProps {
  projectId: string;
  projectName?: string;
}

export default function ProjectTabs({ projectId, projectName }: ProjectTabsProps) {
  const [activePhase, setActivePhase] = useState<Phase>("Overview");
  const [activeSubId, setActiveSubId] = useState<string>("summary");

  const selectPhase = (phase: Phase) => {
    setActivePhase(phase);
    const first = PHASES.find((p) => p.id === phase)?.subtabs[0];
    if (first) setActiveSubId(first.id);
  };

  const currentSubtabs = PHASES.find((p) => p.id === activePhase)?.subtabs ?? [];

  const activeSub = currentSubtabs.find((s) => s.id === activeSubId);

  const pillScrollRef = useRef<HTMLDivElement>(null);
  const [pillsOverflow, setPillsOverflow] = useState(false);

  useEffect(() => {
    const el = pillScrollRef.current;
    if (!el) return;
    const checkOverflow = () => setPillsOverflow(el.scrollWidth > el.clientWidth + 1);
    checkOverflow();
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div>
      {/* Section pills. On narrow viewports the 10 pills don't all fit --
          they scroll horizontally, with a right-edge fade shown only while
          there's actually more to scroll to (checked via ResizeObserver,
          not assumed). */}
      <div
        className="border-b border-white/8 px-4 py-4 sm:px-6"
        style={pillsOverflow ? { maskImage: "linear-gradient(to right, black calc(100% - 28px), transparent 100%)", WebkitMaskImage: "linear-gradient(to right, black calc(100% - 28px), transparent 100%)" } : undefined}
      >
        <div ref={pillScrollRef} className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {PHASES.map((phase) => (
            <button
              key={phase.id}
              onClick={() => selectPhase(phase.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-5 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${
                activePhase === phase.id
                  ? "border-[#CCFF00]/40 bg-[#CCFF00]/10 text-[#CCFF00]"
                  : "border-white/10 bg-white/5 text-white/60 hover:text-white/80"
              }`}
            >
              {phase.id === "Overview" && <LayoutGrid size={13} />}
              {phase.id}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      {currentSubtabs.length > 1 && (
        <div className="border-b border-white/8 px-4 sm:px-6">
          <div className="flex items-end overflow-x-auto scrollbar-hide">
            {currentSubtabs.map((sub) => (
              <button
                key={sub.id}
                onClick={() => setActiveSubId(sub.id)}
                className={`group flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  activeSubId === sub.id
                    ? "border-[#CCFF00] text-white"
                    : "border-transparent text-white/30 hover:text-white/60"
                }`}
              >
                <span className={activeSubId === sub.id ? "text-[#CCFF00]" : "text-white/25 group-hover:text-white/50"}>
                  {sub.icon}
                </span>
                <span className="hidden sm:inline">{sub.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        {activeSub ? activeSub.render(projectId, projectName ?? "") : null}
      </div>
    </div>
  );
}

function RiskAssessmentTab({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-4">
      <RiskDigestCard projectId={projectId} />
      <div className="rounded-xl border border-white/8 bg-[#0E0F12] p-5 text-sm text-white/55">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40 mb-2">What this is</p>
        <p>
          The AI Risk Digest reads your live project state — open RFIs, schedule slack, budget variance, weather forecast, missing submittals — and surfaces the issues most likely to bite you next. Regenerate any time you want a fresh read.
        </p>
      </div>
    </div>
  );
}

interface OverviewCounts {
  takeoff_items: number; documents: number; schedule_tasks: number;
  contacts: number; daily_logs: number; generated_docs: number;
  procurement_total: number; procurement_pending: number;
  punch_total: number; punch_open: number;
  permits_total: number; permits_approved: number;
  rfis_open: number; submittals_open: number;
  change_orders_pending: number; pending_change_order_value: number;
  estimate_value: number; completion: number;
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function OverviewTab({ projectId }: { projectId: string }) {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    fetch(`/api/overview?project_id=${projectId}`)
      .then((r) => r.json())
      .then((d) => setCounts(d))
      .catch(() => {});
  }, [projectId]);

  const generateReport = async () => {
    if (reporting) return;
    setReporting(true);
    setReport(null);
    try {
      const res = await fetch("/api/status-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const d = await res.json() as { report?: string; error?: string; code?: string };
      if (res.ok && d.report) setReport(d.report);
      else if (d.code === "NO_PROVIDER") setReport("No AI model connected. Check GEMINI_API_KEY in Vercel.");
      else setReport(`Error: ${d.error ?? res.status}`);
    } finally {
      setReporting(false);
    }
  };

  const c = counts;
  const stats: { label: string; value: string; alert?: boolean }[] = [
    { label: "Completion",     value: c ? `${c.completion}%` : "—" },
    { label: "Estimate Value", value: c ? money(c.estimate_value) : "—" },
    { label: "Takeoff Items",  value: c ? String(c.takeoff_items) : "—" },
    { label: "Documents",      value: c ? String(c.documents) : "—" },
    { label: "Open Punch",     value: c ? `${c.punch_open}/${c.punch_total}` : "—",    alert: !!(c && c.punch_open > 0) },
    { label: "Permits OK",     value: c ? `${c.permits_approved}/${c.permits_total}` : "—" },
    { label: "Procurement",    value: c ? `${c.procurement_pending} pending` : "—" },
    { label: "Open Controls",  value: c ? String(c.rfis_open + c.submittals_open) : "—", alert: !!(c && c.rfis_open + c.submittals_open > 0) },
    { label: "Pending COs",    value: c ? money(c.pending_change_order_value) : "—" },
    { label: "Daily Logs",     value: c ? String(c.daily_logs) : "—" },
  ];

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`rounded-xl border bg-[#111113] p-4 transition-colors hover:border-white/20 ${s.alert ? "border-red-500/20" : "border-white/8"}`}
          >
            <p className={`text-2xl font-black leading-none ${s.alert ? "text-red-400" : "text-white"}`}>{s.value}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">{s.label}</p>
          </div>
        ))}
      </div>

      {/* AI Status Report */}
      <div className="rounded-xl border border-white/8 bg-[#111113] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">AI Project Status Report</p>
            <p className="mt-1 text-xs text-white/25">Executive summary from live project data</p>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <button
                onClick={() => printDocument("Project Status Report", report, "Onyx Intel")}
                className="h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/40 transition-colors hover:bg-white/8 hover:text-white"
              >
                Print / PDF
              </button>
            )}
            <button
              onClick={generateReport}
              disabled={reporting}
              className="h-8 rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-4 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/20 disabled:opacity-40"
            >
              {reporting ? "Generating…" : report ? "Regenerate" : "Generate Report"}
            </button>
          </div>
        </div>
        {report ? (
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-white/60">{report}</pre>
        ) : (
          <p className="text-xs text-white/25">
            Generate an executive summary from this project&apos;s live data — schedule, budget, open punch items, permits, procurement, and recent field activity.
          </p>
        )}
      </div>
    </div>
  );
}
