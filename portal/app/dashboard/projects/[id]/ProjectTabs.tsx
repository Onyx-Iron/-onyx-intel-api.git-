"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import EstimateMatrix           from "@/components/estimate/EstimateMatrix";
import ProjectControlsTab       from "@/components/project-controls/ProjectControlsTab";
import PunchListTab             from "@/components/punchlist/PunchListTab";
import DocumentsTab             from "@/components/documents/DocumentsTab";
import DailyLogTab              from "@/components/dailylog/DailyLogTab";
import ContactsTab              from "@/components/contacts/ContactsTab";
import RiskDigestCard           from "@/components/project/RiskDigestCard";
import ProjectMemoryPanel       from "@/components/project/ProjectMemoryPanel";
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
import {
  BudgetTab,
  ChangeEventsPanel,
  CloseoutAssembly,
  MeetingsTab,
  PayAppsTab,
  ProjectFileBrief,
  RecordLinker,
  RemainingCivil,
  SelectionsTab,
  TimeCardsTab,
} from "@/components/project-file/ProjectFilePanels";
import { phaseFromSlug, PROJECT_SECTIONS, type ProjectPhase } from "@/lib/navigation/project-sections";

// Target 10-section IA (docs/frontend-backend-reconciliation/INFORMATION_ARCHITECTURE.md)
// replacing the prior 5-phase/~21-subtab structure. This recomposes the same
// existing *Tab.tsx components into fewer top-level sections -- none of the
// underlying tab components were rewritten, only regrouped.
type Phase = ProjectPhase;

function phaseSlug(phase: Phase): string {
  return PROJECT_SECTIONS.find((section) => section.id === phase)?.slug ?? "overview";
}

/** Old `?section=` deep links from roll-up pages before phase/tab IA. */
const LEGACY_SECTION_TO_PHASE_TAB: Record<string, { phase: Phase; tab: string }> = {
  "project-controls": { phase: "Project Controls", tab: "controls" },
  controls: { phase: "Project Controls", tab: "controls" },
  schedule: { phase: "Schedule", tab: "scheduling" },
  field: { phase: "Field", tab: "daily-log" },
  closeout: { phase: "Closeout", tab: "punchlist" },
  documents: { phase: "Documents", tab: "documents" },
  takeoff: { phase: "Takeoff", tab: "takeoff" },
  estimate: { phase: "Estimate & Budget", tab: "estimates" },
  procurement: { phase: "Procurement", tab: "procurement" },
  financials: { phase: "Financials", tab: "ar" },
};

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
      { id: "cutfill", label: "Cut / Fill", icon: <Layers size={13} />, render: (p) => (
        <div className="space-y-4">
          <RemainingCivil projectId={p} />
          <CutFillTab projectId={p} />
        </div>
      ) },
    ],
  },
  {
    id: "Estimate & Budget",
    subtabs: [
      { id: "estimates", label: "Estimate & Budget", icon: <Calculator size={13} />, render: (p, name) => <EstimateMatrix projectId={p} projectName={name} /> },
      { id: "budget", label: "Budget", icon: <Coins size={13} />, render: (p) => <BudgetTab projectId={p} /> },
      { id: "selections", label: "Selections", icon: <ListChecks size={13} />, render: (p) => <SelectionsTab projectId={p} /> },
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
      { id: "controls", label: "RFIs, Submittals & Change Orders", icon: <FileStack size={13} />, render: (p) => (
        <div className="space-y-4">
          <ChangeEventsPanel projectId={p} />
          <RecordLinker projectId={p} />
          <ProjectControlsTab projectId={p} />
        </div>
      ) },
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
      { id: "pay-apps", label: "Pay Applications", icon: <Receipt size={13} />, render: (p) => <PayAppsTab projectId={p} /> },
    ],
  },
  {
    id: "Field",
    subtabs: [
      { id: "daily-log",  label: "Daily Log",  icon: <ClipboardList size={13} />, render: (p) => <DailyLogTab projectId={p} /> },
      { id: "weekly-log", label: "Weekly Log", icon: <FileText size={13} />,      render: (p) => <WeeklyLogTab projectId={p} /> },
      { id: "todo",       label: "To Do List", icon: <ListChecks size={13} />,    render: (p) => <TodoTab projectId={p} /> },
      { id: "staff",      label: "Staff",      icon: <HardHat size={13} />,       render: (p) => <StaffTab projectId={p} /> },
      { id: "time",       label: "Time Cards", icon: <ClipboardList size={13} />, render: (p) => <TimeCardsTab projectId={p} /> },
      { id: "meetings",   label: "Meetings",   icon: <CalendarDays size={13} />,  render: (p) => <MeetingsTab projectId={p} /> },
    ],
  },
  {
    id: "Closeout",
    subtabs: [
      { id: "punchlist",  label: "Punchlist",                icon: <ListChecks size={13} />, render: (p) => (
        <div className="space-y-4">
          <RecordLinker projectId={p} />
          <PunchListTab projectId={p} />
        </div>
      ) },
      { id: "co",         label: "Certificate of Occupancy", icon: <Award size={13} />,      render: (p) => <CertificateOfOccupancyTab projectId={p} /> },
      { id: "inspections", label: "Closeout Assembly", icon: <FileCheck size={13} />, render: (p) => <CloseoutAssembly projectId={p} /> },
      { id: "final-docs", label: "Final Docs",               icon: <FileText size={13} />,   render: (p) => <DocumentsTab projectId={p} mode="closeout" /> },
    ],
  },
];

interface ProjectTabsProps {
  projectId: string;
  projectName?: string;
}

export default function ProjectTabs({ projectId, projectName }: ProjectTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL is the source of truth so back/forward and refresh keep the same tab
  // without syncing search params into React state via an effect.
  const legacyFromSection = LEGACY_SECTION_TO_PHASE_TAB[searchParams.get("section") ?? ""];
  const activePhase =
    phaseFromSlug(searchParams.get("phase")) ?? legacyFromSection?.phase ?? "Overview";
  const currentSubtabs = PHASES.find((p) => p.id === activePhase)?.subtabs ?? [];
  const tabFromUrl = searchParams.get("tab") ?? legacyFromSection?.tab ?? null;
  const activeSubId =
    (tabFromUrl && currentSubtabs.some((s) => s.id === tabFromUrl) ? tabFromUrl : null) ??
    currentSubtabs[0]?.id ??
    "summary";
  const activeSub = currentSubtabs.find((s) => s.id === activeSubId);

  const syncUrl = useCallback(
    (phase: Phase, tab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("section");
      params.set("phase", phaseSlug(phase));
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Normalize stale `?section=` bookmarks into `?phase=&tab=` so shared links stay stable.
  useEffect(() => {
    const section = searchParams.get("section");
    if (!section || searchParams.get("phase")) return;
    const mapped = LEGACY_SECTION_TO_PHASE_TAB[section];
    if (!mapped) return;
    syncUrl(mapped.phase, mapped.tab);
  }, [searchParams, syncUrl]);

  const selectPhase = (phase: Phase) => {
    const first = PHASES.find((p) => p.id === phase)?.subtabs[0];
    if (first) syncUrl(phase, first.id);
  };

  const selectSub = (subId: string) => {
    syncUrl(activePhase, subId);
  };

  return (
    <div id="phase-tabs" className="lg:grid lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:items-start">
      {/* Mobile: one section control instead of 10 scrolling pills */}
      <div className="border-b border-white/8 px-4 py-3 sm:px-6 lg:hidden">
        <label htmlFor="project-section-select" className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
          Section
        </label>
        <select
          id="project-section-select"
          value={activePhase}
          onChange={(e) => selectPhase(e.target.value as Phase)}
          className="h-10 w-full rounded-lg border border-white/10 bg-[#0E0F12] px-3 text-sm text-white outline-none focus:border-[#CCFF00]/50"
        >
          {PHASES.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.id}
            </option>
          ))}
        </select>
        {currentSubtabs.length > 1 && (
          <div className="mt-3 flex gap-1 overflow-x-auto scrollbar-hide">
            {currentSubtabs.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => selectSub(sub.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  activeSubId === sub.id
                    ? "border-[#CCFF00]/40 bg-[#CCFF00]/10 text-[#CCFF00]"
                    : "border-white/10 text-white/45 hover:text-white/70"
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: calm vertical section list — no pill storm */}
      <aside className="hidden border-r border-white/8 lg:block lg:sticky lg:top-0 lg:self-start lg:py-6">
        <p className="mb-3 px-4 text-[9px] font-bold uppercase tracking-[0.22em] text-white/30">
          Project sections
        </p>
        <nav className="space-y-0.5 px-2" aria-label="Project sections">
          {PHASES.map((phase) => {
            const active = activePhase === phase.id;
            return (
              <button
                key={phase.id}
                type="button"
                onClick={() => selectPhase(phase.id)}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-[#CCFF00]/10 text-[#CCFF00]"
                    : "text-white/45 hover:bg-white/[0.03] hover:text-white/80"
                }`}
              >
                {phase.id}
              </button>
            );
          })}
        </nav>
      </aside>

      <div>
        {currentSubtabs.length > 1 && (
          <div className="hidden border-b border-white/8 px-6 lg:block">
            <div className="flex items-end gap-1">
              {currentSubtabs.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => selectSub(sub.id)}
                  className={`group flex items-center gap-1.5 border-b-2 px-3 py-3 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                    activeSubId === sub.id
                      ? "border-[#CCFF00] text-white"
                      : "border-transparent text-white/30 hover:text-white/60"
                  }`}
                >
                  <span className={activeSubId === sub.id ? "text-[#CCFF00]" : "text-white/25 group-hover:text-white/50"}>
                    {sub.icon}
                  </span>
                  {sub.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 py-6 sm:px-6 sm:py-8">
          {activeSub ? activeSub.render(projectId, projectName ?? "") : null}
        </div>
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
  const [showMoreStats, setShowMoreStats] = useState(false);

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
  const primaryStats: { label: string; value: string; alert?: boolean }[] = [
    { label: "Completion",     value: c ? `${c.completion}%` : "—" },
    { label: "Estimate Value", value: c ? money(c.estimate_value) : "—" },
    { label: "Open Controls",  value: c ? String(c.rfis_open + c.submittals_open) : "—", alert: !!(c && c.rfis_open + c.submittals_open > 0) },
    { label: "Open Punch",     value: c ? `${c.punch_open}/${c.punch_total}` : "—",    alert: !!(c && c.punch_open > 0) },
  ];
  const moreStats: { label: string; value: string; alert?: boolean }[] = [
    { label: "Takeoff Items",  value: c ? String(c.takeoff_items) : "—" },
    { label: "Documents",      value: c ? String(c.documents) : "—" },
    { label: "Permits OK",     value: c ? `${c.permits_approved}/${c.permits_total}` : "—" },
    { label: "Procurement",    value: c ? `${c.procurement_pending} pending` : "—" },
    { label: "Pending COs",    value: c ? money(c.pending_change_order_value) : "—" },
    { label: "Daily Logs",     value: c ? String(c.daily_logs) : "—" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {primaryStats.map((s) => (
          <div
            key={s.label}
            className={`rounded-xl border bg-[#111113] p-4 transition-colors hover:border-white/20 ${s.alert ? "border-red-500/20" : "border-white/8"}`}
          >
            <p className={`text-2xl font-black leading-none ${s.alert ? "text-red-400" : "text-white"}`}>{s.value}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">{s.label}</p>
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowMoreStats((v) => !v)}
          className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35 transition-colors hover:text-white/60"
        >
          {showMoreStats ? "Hide more metrics" : "Show more metrics"}
        </button>
        {showMoreStats && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {moreStats.map((s) => (
              <div
                key={s.label}
                className={`rounded-xl border bg-[#111113] p-4 ${s.alert ? "border-red-500/20" : "border-white/8"}`}
              >
                <p className={`text-xl font-black leading-none ${s.alert ? "text-red-400" : "text-white"}`}>{s.value}</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <ProjectFileBrief projectId={projectId} />
      <ProjectMemoryPanel projectId={projectId} />

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
