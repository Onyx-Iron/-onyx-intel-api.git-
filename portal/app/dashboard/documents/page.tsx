"use client";

import { useEffect, useState } from "react";
import { Info, FileText } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";

type DocStatus = "pending" | "processing" | "complete" | "error";

interface Document {
  id: string;
  file_name: string;
  status: DocStatus;
  pages: number | null;
  uploaded_at: string | null;
  project_id: string | null;
}

const STATUS_STYLES: Record<DocStatus, string> = {
  pending:    "bg-white/5 text-gray-500 border-white/10",
  processing: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  complete:   "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  error:      "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
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

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Documents"
        description="All processed plan files"
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      {error && <div className="mb-4"><ErrorState message={error} onRetry={loadDocuments} /></div>}
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
        <Info size={12} className="shrink-0" />
        <span>Upload documents from a project&apos;s Documents tab — workspace view is read-only and aggregates across all projects.</span>
      </div>
      <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#0A0A0B] border-b border-white/10">
              <tr>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">File Name</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Status</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Pages</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows />
              ) : documents.length === 0 && !error ? (
                <tr>
                  <td colSpan={5}>
                    <div className="py-4">
                      <EmptyState
                        icon={<FileText className="w-6 h-6" />}
                        title="No documents yet"
                        description="Upload contracts, plans, and shared docs."
                        actionLabel="Upload"
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                documents.map((doc) => {
                  const statusKey = (doc.status as string) in STATUS_STYLES ? doc.status : "pending";
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
                        {doc.project_id ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[statusKey]}`} aria-label={`Status: ${doc.status}`}>
                          {doc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">
                        {doc.pages != null ? doc.pages : "—"}
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
