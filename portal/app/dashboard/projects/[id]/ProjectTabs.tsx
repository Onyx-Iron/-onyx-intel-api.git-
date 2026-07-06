"use client";

import { useEffect, useState } from "react";
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
  Package,
  PackageOpen,
  Receipt,
  ShieldCheck,
  Truck,
  Users,
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
import ComingSoonTab            from "@/components/common/ComingSoonTab";
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

type Phase = "Pre-Construction" | "Project Setup" | "Project Management" | "Invoicing" | "Closeout";

interface SubTabDef {
  id: string;
  label: string;
  icon: JSX.Element;
  render: (projectId: string) => JSX.Element;
}

const PHASES: { id: Phase; subtabs: SubTabDef[] }[] = [
  {
    id: "Pre-Construction",
    subtabs: [
      { id: "takeoff",   label: "Takeoff",         icon: <Layers size={13} />,        render: (p) => <TakeoffTab projectId={p} /> },
      { id: "estimates", label: "Estimates",       icon: <Calculator size={13} />,    render: (p) => <EstimateTab projectId={p} /> },
      { id: "rfis",      label: "RFIs & Controls", icon: <FileStack size={13} />,     render: (p) => <ProjectControlsTab projectId={p} /> },
      { id: "risk",      label: "Risk Assessment", icon: <AlertTriangle size={13} />, render: (p) => <RiskAssessmentTab projectId={p} /> },
      { id: "cutfill",   label: "Cut / Fill",      icon: <Layers size={13} />,        render: (p) => <CutFillTab projectId={p} /> },
    ],
  },
  {
    id: "Project Setup",
    subtabs: [
      { id: "materials",  label: "Material Vendors",     icon: <PackageOpen size={13} />, render: (p) => <MaterialVendorsTab projectId={p} /> },
      { id: "equipment",  label: "Equipment Suppliers",  icon: <Truck size={13} />,       render: (p) => <EquipmentSuppliersTab projectId={p} /> },
      { id: "subs",       label: "Subcontractors",       icon: <Hammer size={13} />,      render: (p) => <ContactsTab projectId={p} /> },
      { id: "staff",      label: "Staff",                icon: <HardHat size={13} />,     render: (p) => <StaffTab projectId={p} /> },
    ],
  },
  {
    id: "Project Management",
    subtabs: [
      { id: "daily-log",  label: "Daily Log",   icon: <ClipboardList size={13} />, render: (p) => <DailyLogTab projectId={p} /> },
      { id: "weekly-log", label: "Weekly Log",  icon: <FileText size={13} />,      render: (p) => <WeeklyLogTab projectId={p} /> },
      { id: "scheduling", label: "Scheduling",  icon: <CalendarDays size={13} />,  render: (p) => <ScheduleTab projectId={p} /> },
      { id: "todo",       label: "To Do List",  icon: <ListChecks size={13} />,    render: (p) => <TodoTab projectId={p} /> },
    ],
  },
  {
    id: "Invoicing",
    subtabs: [
      { id: "ar",            label: "Accounts Receivable", icon: <Banknote size={13} />,    render: (p) => <AccountsReceivableTab projectId={p} /> },
      { id: "ap",            label: "Accounts Payable",    icon: <Receipt size={13} />,     render: (p) => <AccountsPayableTab projectId={p} /> },
      { id: "open",          label: "Open Invoices",       icon: <Coins size={13} />,       render: (p) => <OpenInvoicesTab projectId={p} /> },
      { id: "closed",        label: "Closed Invoices",     icon: <FileCheck size={13} />,   render: (p) => <ClosedInvoicesTab projectId={p} /> },
      { id: "lien-waivers",  label: "Lien Waivers",        icon: <ShieldCheck size={13} />, render: (p) => <LienWaiversTab projectId={p} /> },
    ],
  },
  {
    id: "Closeout",
    subtabs: [
      { id: "punchlist",  label: "Punchlist",                 icon: <ListChecks size={13} />, render: (p) => <PunchListTab projectId={p} /> },
      { id: "co",         label: "Certificate of Occupancy",  icon: <Award size={13} />,      render: (p) => <CertificateOfOccupancyTab projectId={p} /> },
      { id: "final-docs", label: "Final Docs",                icon: <FileText size={13} />,   render: (p) => <DocumentsTab projectId={p} /> },
    ],
  },
];

interface ProjectTabsProps {
  projectId: string;
}

export default function ProjectTabs({ projectId }: ProjectTabsProps) {
  const [activePhase, setActivePhase] = useState<Phase | null>(null);
  const [activeSubId, setActiveSubId] = useState<string>("overview");

  const selectPhase = (phase: Phase) => {
    setActivePhase(phase);
    const first = PHASES.find((p) => p.id === phase)?.subtabs[0];
    if (first) setActiveSubId(first.id);
  };

  const selectOverview = () => {
    setActivePhase(null);
    setActiveSubId("overview");
  };

  const currentSubtabs = activePhase
    ? PHASES.find((p) => p.id === activePhase)?.subtabs ?? []
    : [];

  const activeSub = currentSubtabs.find((s) => s.id === activeSubId);

  return (
    <div>
      {/* Phase pills */}
      <div className="border-b border-white/8 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <button
            onClick={selectOverview}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-5 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${
              activePhase === null
                ? "border-[#CCFF00]/40 bg-[#CCFF00]/10 text-[#CCFF00]"
                : "border-white/10 bg-white/5 text-white/60 hover:text-white/80"
            }`}
          >
            <LayoutGrid size={13} />
            Overview
          </button>
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
              {phase.id}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      {activePhase && currentSubtabs.length > 0 && (
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
        {activePhase === null ? (
          <OverviewTab projectId={projectId} />
        ) : activeSub ? (
          activeSub.render(projectId)
        ) : null}
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
