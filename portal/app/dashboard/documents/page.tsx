"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Info, FileText } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import ProjectScopeSelect, { filterByActiveProject } from "@/components/project/ProjectScopeSelect";
import { useProjectContext } from "@/components/project/ProjectContext";
import { PipelineStage, type PipelineStatus } from "@/components/documents/PipelineStage";
import { statusLabel } from "@/lib/documents/status";
import { chooseOrCreateProjectHref } from "@/lib/navigation/project-sections";

type DocStatus =
  | "pending"
  | "queued"
  | "processing"
  | "split"
  | "ready"
  | "complete"
  | "done"
  | "complete_with_errors"
  | "error"
  | "failed";

interface ProcessingSummary {
  pages_total: number;
  pages_ocr_ok: number;
  pages_ocr_failed: number;
  pages_takeoff_ok: number;
  pages_takeoff_failed: number;
}

interface Document {
  id: string;
  file_name: string;
  status: DocStatus | string;
  pages: number | null;
  page_count: number | null;
  uploaded_at: string | null;
  project_id: string | null;
  split_status: PipelineStatus | null;
  ocr_status: PipelineStatus | null;
  vector_status: PipelineStatus | null;
  takeoff_status: PipelineStatus | null;
  last_error: string | null;
  last_error_step: string | null;
  meta?: { processing_summary?: ProcessingSummary } | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending:    "bg-white/5 text-gray-500 border-white/10",
  queued:     "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  processing: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  split:      "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  ready:      "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  complete:   "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  done:       "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  complete_with_errors: "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/20",
  error:      "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  failed:     "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SkeletonRows() {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i}>
          {[...Array(5)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div
                className="h-3 bg-white/5 animate-pulse rounded"
                style={{ width: j === 0 ? "65%" : "40%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DocumentsPage() {
  const { activeProjectId, activeProject, projects } = useProjectContext();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = () => {
    setLoading(true);
    setError(null);
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { documents?: Document[] };
        setDocuments(data.documents ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadDocuments(); }, []);

  const filtered = useMemo(
    () => filterByActiveProject(documents, activeProjectId),
    [documents, activeProjectId],
  );

  const openWorkspaceHref = chooseOrCreateProjectHref(activeProject?.id, "documents", "documents");

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Documents"
        description={
          activeProject
            ? `Ingestion pipeline status for ${activeProject.name}`
            : "Every file's ingestion pipeline status, across all projects"
        }
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      {error && <div className="mb-4"><ErrorState message={error} onRetry={loadDocuments} /></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
          <Info size={12} className="shrink-0" />
          <span>Upload documents from a project&apos;s Documents tab — this view is read-only and tracks each file through split → OCR → vector → takeoff.</span>
        </div>
        <ProjectScopeSelect className="w-56" label="" />
      </div>
      <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#0A0A0B] border-b border-white/10">
              <tr>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">File Name</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Status</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Pipeline</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Pages</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Uploaded</th>
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
                        icon={<FileText className="w-6 h-6" />}
                        title="No documents yet"
                        description="Upload a plan PDF from a project workspace — this view tracks split, OCR, and takeoff."
                        actionLabel={activeProject ? "Upload a plan PDF" : "Choose or create a project"}
                        actionHref={openWorkspaceHref}
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((doc) => {
                  const statusKey = (doc.status as string) in STATUS_STYLES ? doc.status : "pending";
                  const projectName = projects.find((project) => project.id === doc.project_id)?.name;
                  const workspaceHref = doc.project_id
                    ? `/dashboard/projects/${doc.project_id}?phase=documents&tab=documents`
                    : null;
                  return (
                    <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <svg className="w-3 h-3 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {workspaceHref ? (
                            <Link href={workspaceHref} className="max-w-xs truncate text-xs text-white hover:text-[#CCFF00]">
                              {doc.file_name}
                            </Link>
                          ) : (
                            <span className="max-w-xs truncate text-xs text-white">{doc.file_name}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {workspaceHref ? (
                          <Link href={workspaceHref} className="hover:text-[#CCFF00]">
                            {projectName ?? "Open project"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[statusKey]}`} aria-label={`Status: ${doc.status}`}>
                          {statusLabel(doc.status)}
                        </span>
                        {doc.last_error && (
                          <p className="mt-1 max-w-[16rem] truncate text-[9px] text-[#E50914]" title={doc.last_error}>
                            {doc.last_error_step ? `${doc.last_error_step}: ` : ""}{doc.last_error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <PipelineStage label="Split" status={doc.split_status} />
                          <PipelineStage label="OCR" status={doc.ocr_status} />
                          <PipelineStage label="Vector" status={doc.vector_status} />
                          <PipelineStage label="Takeoff" status={doc.takeoff_status} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">
                        <div>{doc.page_count != null ? doc.page_count : doc.pages != null ? doc.pages : "—"}</div>
                        {doc.meta?.processing_summary && (
                          <p className="mt-1 text-[9px] font-sans leading-snug text-white/40">
                            OCR {doc.meta.processing_summary.pages_ocr_ok}/{doc.meta.processing_summary.pages_total}
                            {doc.meta.processing_summary.pages_ocr_failed > 0 ? ` · ${doc.meta.processing_summary.pages_ocr_failed} failed` : ""}
                            {" · "}
                            takeoff {doc.meta.processing_summary.pages_takeoff_ok}/{doc.meta.processing_summary.pages_total}
                            {doc.meta.processing_summary.pages_takeoff_failed > 0 ? ` · ${doc.meta.processing_summary.pages_takeoff_failed} failed` : ""}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmt(doc.uploaded_at)}</td>
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
