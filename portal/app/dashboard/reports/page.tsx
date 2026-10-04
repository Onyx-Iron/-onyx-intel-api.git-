"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, RefreshCw, Wand2 } from "lucide-react";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import PageHero from "@/components/layout/PageHero";
import ProjectScopeSelect from "@/components/project/ProjectScopeSelect";
import { useProjectContext } from "@/components/project/ProjectContext";

interface ReportRun {
  id: string;
  project_id: string;
  report_type: string;
  title: string;
  status: string;
  provider: string | null;
  summary: {
    project_name?: string;
    completion?: number;
    estimate_value?: number | null;
    estimate_ready?: boolean;
    risk_score?: number;
  } | null;
  body?: string | null;
  financials_redacted?: boolean;
  generated_at: string | null;
  created_at: string;
  projects?: { name?: string } | null;
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function money(value?: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export default function ReportsPage() {
  const { projects, activeProjectId, setActiveProjectId } = useProjectContext();
  const [reports, setReports] = useState<ReportRun[]>([]);
  const selectedProject = activeProjectId ?? "";
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedReport = useMemo(
    () => (detail?.id === selectedReportId ? detail : reports.find((report) => report.id === selectedReportId) ?? null),
    [detail, reports, selectedReportId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reportRes = await fetch("/api/reports?limit=100", { cache: "no-store" });
      const reportData = await reportRes.json();
      if (!reportRes.ok) throw new Error(reportData.error ?? "Could not load reports");
      setReports(reportData.reports ?? []);
      setSelectedReportId((current) => current ?? reportData.reports?.[0]?.id ?? null);
      if (!activeProjectId && projects[0]) setActiveProjectId(projects[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, projects, setActiveProjectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!selectedReportId) return;
    const hasBody = reports.find((report) => report.id === selectedReportId && report.body);
    if (hasBody) return;
    let cancelled = false;
    fetch(`/api/reports/${selectedReportId}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ res, json })))
      .then(({ res, json }) => {
        if (res.ok && !cancelled) setDetail(json.report);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reports, selectedReportId]);

  const generate = async () => {
    if (!selectedProject) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: selectedProject, report_type: "project_status" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Report generation failed");
      const report = data.report as ReportRun;
      setReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
      setSelectedReportId(report.id);
      setDetail(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (!selectedReport?.body) return;
    const blob = new Blob([selectedReport.body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedReport.title.replace(/[^\w-]+/g, "_")}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Reports"
        description="Generate, preserve, and export tenant-scoped executive project reports."
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

        <section className="mb-5 grid gap-3 border-b border-white/8 pb-5 lg:grid-cols-[1fr_auto]">
          <ProjectScopeSelect allowAll={false} className="max-w-xl" />
          <div className="flex items-end">
            <button
              type="button"
              onClick={generate}
              disabled={!selectedProject || generating}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Wand2 size={14} /> {generating ? "Generating" : "Generate Report"}
            </button>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <section className="min-h-[420px] overflow-hidden rounded-xl border border-white/8 bg-[#0E0F12]">
            <div className="border-b border-white/8 px-4 py-3">
              <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">History</h2>
            </div>
            {loading ? (
              <div className="space-y-3 p-4">
                {[...Array(5)].map((_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-white/[0.04]" />)}
              </div>
            ) : reports.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-6 w-6" />}
                title="No reports yet"
                description="Generate the first project report to create a preserved report history."
              />
            ) : (
              <div className="divide-y divide-white/5">
                {reports.map((report) => {
                  const active = report.id === selectedReportId;
                  return (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedReportId(report.id)}
                      className={`block w-full px-4 py-3 text-left transition-colors ${active ? "bg-[#CCFF00]/8" : "hover:bg-white/[0.03]"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 text-sm font-semibold text-white">{report.title}</p>
                        <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white/35">
                          {report.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-white/35">{report.projects?.name ?? report.summary?.project_name ?? report.project_id}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-white/25">{fmtDate(report.generated_at)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-h-[420px] rounded-xl border border-white/8 bg-[#0E0F12]">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Report Detail</h2>
                {selectedReport && <p className="mt-1 text-[11px] text-white/30">{fmtDate(selectedReport.generated_at)} by {selectedReport.provider ?? "provider n/a"}</p>}
              </div>
              <button
                type="button"
                onClick={download}
                disabled={!selectedReport?.body}
                className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 px-3 text-[10px] font-bold uppercase tracking-widest text-white/60 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Download size={12} /> Export
              </button>
            </div>

            {!selectedReport ? (
              <EmptyState
                icon={<FileText className="h-6 w-6" />}
                title="Select a report"
                description="Generated reports appear here with preserved source metrics and exportable text."
              />
            ) : (
              <div className="p-5">
                <div className="mb-5 grid gap-3 sm:grid-cols-4">
                  <Metric label="Completion" value={`${selectedReport.summary?.completion ?? 0}%`} />
                  <Metric label="Estimate" value={money(selectedReport.summary?.estimate_value)} />
                  <Metric label="QC Ready" value={selectedReport.summary?.estimate_ready ? "Yes" : "No"} />
                  <Metric label="Risk" value={`${selectedReport.summary?.risk_score ?? "-"} / 100`} />
                </div>
                <article className="whitespace-pre-wrap rounded-lg border border-white/8 bg-black/20 p-4 text-sm leading-7 text-white/75">
                  {selectedReport.financials_redacted
                    ? "This report includes pricing, so the narrative is hidden for your role."
                    : (selectedReport.body ?? "Loading report body...")}
                </article>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-[#CCFF00]/40 pl-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
