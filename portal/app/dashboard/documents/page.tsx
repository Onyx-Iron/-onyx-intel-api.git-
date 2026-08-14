"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Info, FileText } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import GoogleConnect from "@/components/google/GoogleConnect";

type DocStatus = "pending" | "processing" | "complete" | "error";
type PipelineStatus = "pending" | "processing" | "done" | "error" | "partially_completed" | "skipped";

interface Document {
  id: string;
  file_name: string;
  status: DocStatus;
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
}

const STATUS_STYLES: Record<DocStatus, string> = {
  pending: "bg-white/5 text-gray-500 border-white/10",
  processing: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  complete: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  error: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

const PIPELINE_DOT: Record<PipelineStatus, string> = {
  pending: "bg-white/15",
  processing: "bg-[#00D2FF] animate-pulse",
  done: "bg-[#CCFF00]",
  error: "bg-[#E50914]",
  partially_completed: "bg-[#F5A623]",
  skipped: "bg-white/10",
};

function PipelineStage({ label, status }: { label: string; status: PipelineStatus | null }) {
  const key = (status ?? "pending") as PipelineStatus;
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${status ?? "pending"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${PIPELINE_DOT[key] ?? "bg-white/15"}`} />
      <span className="text-[9px] uppercase tracking-wider text-white/35">{label}</span>
    </span>
  );
}

function fmt(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SkeletonRows() {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i}>
          {[...Array(5)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "65%" : "40%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [triage, setTriage] = useState("");
  const [triageBusy, setTriageBusy] = useState(false);

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
      .catch((e) => { setError(e?.message ?? "Could not load documents. Refresh the page and try again."); setLoading(false); });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDocuments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const runTriage = async () => {
    if (triageBusy) return;
    setTriageBusy(true);
    try {
      const total = documents.length;
      const ready = documents.filter((doc) => doc.status === "complete");
      const processing = documents.filter((doc) => doc.status === "processing" || doc.status === "pending");
      const errors = documents.filter((doc) => doc.status === "error");
      const lines: string[] = [];
      lines.push(`Document inventory: ${total} total, ${ready.length} ready, ${processing.length} queued or processing, ${errors.length} with errors.`);

      if (brief.trim()) {
        const text = brief.trim().toLowerCase();
        if (text.includes("next") || text.includes("priority") || text.includes("fix")) {
          if (errors.length > 0) {
            lines.push("Next action: open the project Documents tab, reconnect Google if needed, then retry the failed files.");
          } else if (processing.length > 0) {
            lines.push("Next action: let the review finish, then check the ready files.");
          } else {
            lines.push("Next action: upload the next set of files from a project page.");
          }
        }
      }

      if (errors.length > 0) {
        lines.push(`Failures: ${errors.slice(0, 5).map((doc) => `${doc.file_name}${doc.last_error_step ? ` (${doc.last_error_step})` : ""}`).join(" | ")}.`);
      }
      if (processing.length > 0) {
        lines.push(`Still moving: ${processing.slice(0, 5).map((doc) => doc.file_name).join(", ")}.`);
      }
      setTriage(lines.join(" "));
    } finally {
      setTriageBusy(false);
    }
  };

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Documents"
        description="Document status across all projects"
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={loadDocuments} /></div>}

        <section className="mb-4 rounded-xl border border-white/8 bg-[#111113] p-4">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Next step</p>
              <p className="text-[11px] text-white/40">See what is ready, what is stuck, and what to do next.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <GoogleConnect compact />
              <button
                type="button"
                onClick={() => void runTriage()}
                disabled={triageBusy}
                className="inline-flex h-9 items-center rounded-lg border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-3 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {triageBusy ? "Summarizing..." : "Summarize status"}
              </button>
            </div>
          </div>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Example: Tell me the next action on these documents and highlight anything stuck."
            className="min-h-[82px] w-full rounded-lg border border-white/10 bg-[#0A0A0B] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/50"
          />
          {triage && <p className="mt-3 text-[11px] text-white/55">{triage}</p>}
        </section>

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
          <Info size={12} className="shrink-0" />
          <span>Upload documents from a project&apos;s Documents tab. This view shows files across all projects and tracks each one through page split, text reading, indexing, and takeoff so you can see what needs attention next.</span>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#0A0A0B] border-b border-white/10">
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">File Name</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Status</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Stage</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Pages</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <SkeletonRows />
                ) : documents.length === 0 && !error ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="py-4">
                        <EmptyState
                          icon={<FileText className="w-6 h-6" />}
                          title="No documents yet"
                          description="Upload contracts, plans, and shared files to get started."
                          actionLabel="Go to projects"
                          onAction={() => window.location.assign("/dashboard/projects")}
                          secondaryLabel="Open takeoff"
                          secondaryHref="/dashboard/takeoff"
                        />
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                          <Link
                            href="/dashboard/projects"
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-4 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white"
                          >
                            Open projects
                          </Link>
                          <Link
                            href="/dashboard/takeoff"
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-4 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white"
                          >
                            Open takeoff
                          </Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => {
                    const statusKey = (doc.status === "complete" ? "complete" : doc.status === "error" ? "error" : doc.status === "processing" ? "processing" : "pending");
                    return (
                      <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <svg className="w-3 h-3 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-white text-xs truncate max-w-xs">{doc.file_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                          {doc.project_id ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[statusKey]}`} aria-label={`Status: ${doc.status}`}>
                            {doc.status}
                          </span>
                          {doc.last_error && (
                            <p className="mt-1 max-w-[16rem] truncate text-[9px] text-[#E50914]" title={doc.last_error}>
                              {doc.last_error_step ? `${doc.last_error_step}: ` : ""}{doc.last_error}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            <PipelineStage label="Split pages" status={doc.split_status} />
                            <PipelineStage label="Read text" status={doc.ocr_status} />
                            <PipelineStage label="Index" status={doc.vector_status} />
                            <PipelineStage label="Takeoff" status={doc.takeoff_status} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">
                          {doc.page_count != null ? doc.page_count : doc.pages != null ? doc.pages : "-"}
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
