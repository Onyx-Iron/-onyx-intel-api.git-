"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ClipboardCheck, ListChecks, RefreshCw, Users } from "lucide-react";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import PageHero from "@/components/layout/PageHero";
import ProjectScopeSelect from "@/components/project/ProjectScopeSelect";
import { useProjectContext } from "@/components/project/ProjectContext";

type WorkKind = "RFI" | "Submittal" | "Change Order" | "Schedule" | "Punch";

interface Summary {
  project_count: number;
  active_project_count: number;
  open_rfis: number;
  open_submittals: number;
  pending_change_orders: number;
  pending_change_order_value: number | null;
  change_order_values_visible: boolean;
  schedule_total: number;
  schedule_complete: number;
  schedule_completion: number;
  open_punch_items: number;
  overdue_items: number;
  critical_tasks: number;
  daily_logs_recent: number;
  active_staff: number;
}

interface WorkItem {
  id: string;
  kind: WorkKind;
  project_id: string;
  project_name: string;
  title: string;
  status: string | null;
  priority: string | null;
  owner: string | null;
  due_date: string | null;
  href: string;
}

interface DailyLog {
  id: string;
  project_id: string;
  project_name: string;
  log_date: string;
  crew_count: number | null;
  weather: string | null;
  work_performed: string | null;
  notes: string | null;
}

interface WeeklyLog {
  id: string;
  project_id: string;
  project_name: string;
  week_start: string;
  week_end: string;
  schedule_status: string | null;
  budget_status: string | null;
  open_issues: string | null;
  decisions_needed: string | null;
  summary: string | null;
}

interface StaffMember {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  role: string | null;
  project_role: string | null;
}

interface OverviewResponse {
  summary: Summary;
  open_items: WorkItem[];
  recent_daily_logs: DailyLog[];
  recent_weekly_logs: WeeklyLog[];
  active_staff: StaffMember[];
  error?: string;
}

const KIND_STYLES: Record<WorkKind, string> = {
  RFI: "border-[#00D2FF]/20 bg-[#00D2FF]/10 text-[#00D2FF]",
  Submittal: "border-[#CCFF00]/20 bg-[#CCFF00]/10 text-[#CCFF00]",
  "Change Order": "border-[#F5A623]/20 bg-[#F5A623]/10 text-[#F5A623]",
  Schedule: "border-white/10 bg-white/[0.04] text-white/55",
  Punch: "border-[#E50914]/20 bg-[#E50914]/10 text-[#FF6B73]",
};

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function money(value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function statusText(value: string | null): string {
  return (value ?? "open").replace(/_/g, " ");
}

export default function ProjectManagementPage() {
  const { activeProjectId, activeProject } = useProjectContext();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = activeProjectId ? `?project_id=${encodeURIComponent(activeProjectId)}` : "";
      const res = await fetch(`/api/project-management/overview${qs}`, { cache: "no-store" });
      const json = await res.json() as OverviewResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not load project management overview");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = data?.summary;
  const hasOpenItems = (data?.open_items.length ?? 0) > 0;
  const fieldLogs = useMemo(() => data?.recent_daily_logs ?? [], [data]);
  const weeklyLogs = useMemo(() => data?.recent_weekly_logs ?? [], [data]);
  const openWorkspaceHref = activeProject
    ? `/dashboard/projects/${activeProject.id}?phase=controls&tab=controls`
    : "/dashboard/projects";

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Project Management"
        description={
          activeProject
            ? `Schedule, field logs, RFIs, and punch list scoped to ${activeProject.name}`
            : "Cross-project control center for schedule, field logs, RFIs, submittals, change orders, punch list, and staffing."
        }
        compact
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/70 hover:bg-white/[0.06]"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        }
      />

      <main className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="flex-1 text-xs text-white/45">
            {activeProject ? (
              <>
                Showing open work for{" "}
                <Link href={openWorkspaceHref} className="text-[#CCFF00] hover:underline">
                  {activeProject.name}
                </Link>
                . Switch to All projects for the portfolio view.
              </>
            ) : (
              "Portfolio roll-up. Pick a project to focus open work and field logs."
            )}
          </p>
          <ProjectScopeSelect className="w-56" label="" />
        </div>

        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric loading={loading} label="Active Projects" value={summary ? String(summary.active_project_count) : "-"} sub={summary ? `${summary.project_count} total` : ""} />
          <Metric loading={loading} label="Schedule Complete" value={summary ? `${summary.schedule_completion}%` : "-"} sub={summary ? `${summary.schedule_complete}/${summary.schedule_total} tasks` : ""} />
          <Metric loading={loading} label="Open Controls" value={summary ? String(summary.open_rfis + summary.open_submittals + summary.pending_change_orders) : "-"} sub="RFIs, submittals, COs" />
          <Metric loading={loading} label="Overdue / Critical" value={summary ? `${summary.overdue_items} / ${summary.critical_tasks}` : "-"} sub="Open items / critical tasks" tone={summary && (summary.overdue_items > 0 || summary.critical_tasks > 0) ? "warn" : "normal"} />
          <Metric loading={loading} label="Pending CO Value" value={summary ? money(summary.pending_change_order_value) : "-"} sub={summary?.change_order_values_visible ? "Awaiting decision" : "Restricted by role"} />
        </section>

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <MiniStat icon={<ListChecks size={14} />} label="Open Punch" value={summary?.open_punch_items ?? 0} />
          <MiniStat icon={<CalendarDays size={14} />} label="Recent Daily Logs" value={summary?.daily_logs_recent ?? 0} />
          <MiniStat icon={<Users size={14} />} label="Active Staff Assignments" value={summary?.active_staff ?? 0} />
        </div>

        <section className="mb-8 overflow-hidden rounded-xl border border-white/8 bg-[#0E0F12]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
              {activeProject ? "Open Work" : "Open Work Across Projects"}
            </h2>
            {summary && summary.overdue_items > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[#F5A623]">
                <AlertTriangle size={12} /> {summary.overdue_items} overdue
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-white/10 bg-[#0A0A0B]">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Item</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Project</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Owner / Priority</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Due</th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  [...Array(6)].map((_, index) => (
                    <tr key={index}><td colSpan={6} className="px-4 py-3"><div className="h-3 w-2/3 animate-pulse rounded bg-white/5" /></td></tr>
                  ))
                ) : !hasOpenItems && !error ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="No open project-management items" description="RFIs, submittals, schedule tasks, change orders, and punch items appear here when they need attention." />
                    </td>
                  </tr>
                ) : (
                  data?.open_items.map((item) => (
                    <tr key={`${item.kind}-${item.id}`} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${KIND_STYLES[item.kind]}`}>{item.kind}</span>
                      </td>
                      <td className="max-w-md px-4 py-3 text-xs font-medium text-white">
                        <Link href={item.href} className="line-clamp-2 hover:text-[#CCFF00]">{item.title}</Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-white/45">{item.project_name}</td>
                      <td className="px-4 py-3 text-xs text-white/45">{item.owner ?? item.priority ?? "-"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-white/60">{fmtDate(item.due_date)}</td>
                      <td className="px-4 py-3 text-xs capitalize text-white/45">{statusText(item.status)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <LogPanel title="Recent Daily Logs" emptyTitle="No daily logs yet">
            {fieldLogs.map((log) => (
              <LogRow
                key={log.id}
                href={`/dashboard/projects/${log.project_id}?phase=field&tab=daily-log`}
                title={log.work_performed || log.notes || "Daily log"}
                meta={`${log.project_name} / ${fmtDate(log.log_date)}${log.crew_count ? ` / Crew ${log.crew_count}` : ""}${log.weather ? ` / ${log.weather}` : ""}`}
              />
            ))}
          </LogPanel>

          <LogPanel title="Recent Weekly Logs" emptyTitle="No weekly logs yet">
            {weeklyLogs.map((log) => (
              <LogRow
                key={log.id}
                href={`/dashboard/projects/${log.project_id}?phase=field&tab=weekly-log`}
                title={log.summary || log.open_issues || log.decisions_needed || "Weekly log"}
                meta={`${log.project_name} / ${fmtDate(log.week_start)}-${fmtDate(log.week_end)}`}
              />
            ))}
          </LogPanel>
        </div>
      </main>
    </div>
  );
}

function Metric({ loading, label, value, sub, tone = "normal" }: { loading: boolean; label: string; value: string; sub: string; tone?: "normal" | "warn" }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "warn" ? "border-[#F5A623]/25 bg-[#F5A623]/[0.04]" : "border-white/8 bg-[#111113]"}`}>
      {loading ? (
        <div className="h-7 w-20 animate-pulse rounded bg-white/5" />
      ) : (
        <p className={`text-2xl font-black leading-none ${tone === "warn" ? "text-[#F5A623]" : "text-white"}`}>{value}</p>
      )}
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">{label}</p>
      <p className="mt-1 text-[11px] text-white/35">{sub}</p>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3">
      <span className="text-[#CCFF00]">{icon}</span>
      <p className="text-xs text-white/45"><span className="mr-1 font-mono text-white/75">{value}</span>{label}</p>
    </div>
  );
}

function LogPanel({ title, emptyTitle, children }: { title: string; emptyTitle: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const empty = Array.isArray(items) ? items.length === 0 : !items;

  return (
    <section className="overflow-hidden rounded-xl border border-white/8 bg-[#0E0F12]">
      <div className="border-b border-white/8 px-4 py-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">{title}</h2>
      </div>
      {empty ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title={emptyTitle} description="Project field logs will roll up here as crews add them." />
      ) : (
        <div className="divide-y divide-white/5">{items}</div>
      )}
    </section>
  );
}

function LogRow({ href, title, meta }: { href: string; title: string; meta: string }) {
  return (
    <Link href={href} className="block px-4 py-3 transition-colors hover:bg-white/[0.03]">
      <p className="line-clamp-2 text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-[11px] text-white/35">{meta}</p>
    </Link>
  );
}
