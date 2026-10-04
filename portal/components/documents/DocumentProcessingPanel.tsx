"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isPasswordRequired,
  listedMissingPages,
  partialWasAcknowledged,
  plainLanguageError,
  processingStage,
  processingStall,
  sheetMeasureNote,
  takeoffBlockReason,
  type ProcessingStage,
} from "@/lib/documents/processing-display";
import { buildPageLedger, ledgerCounts } from "@/lib/documents/page-ledger";

interface ProcessingDoc {
  id: string;
  file_name: string;
  status: string;
  split_status?: string | null;
  ocr_status?: string | null;
  vector_status?: string | null;
  doc_type?: string | null;
  page_count?: number | null;
  last_error?: string | null;
  last_error_step?: string | null;
  uploaded_at?: string | null;
  meta?: Record<string, unknown> | null;
}

const STAGE_TONE: Record<ProcessingStage, string> = {
  Uploading: "text-white/50",
  Splitting: "text-[#00D2FF]",
  "Reading pages": "text-[#00D2FF]",
  Indexing: "text-[#00D2FF]",
  Complete: "text-[#CCFF00]",
  Partial: "text-[#F5A623]",
  Failed: "text-[#E50914]",
};

export default function DocumentProcessingPanel({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<ProcessingDoc[]>([]);
  const [open, setOpen] = useState(false);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [pageNumbers, setPageNumbers] = useState<Record<string, Array<{ pageNumber: number; failed?: boolean; error?: string | null }>>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/documents?project_id=${encodeURIComponent(projectId)}&limit=200`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json() as { documents?: ProcessingDoc[] };
    const next = data.documents ?? [];
    setDocs(next);
    const attention = next.some((doc) => {
      const stage = processingStage(doc);
      return stage !== "Complete";
    });
    if (attention) setOpen(true);
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void load();
    const onRefresh = () => {
      setOpen(true);
      void load();
    };
    window.addEventListener("onyx:documents-refresh", onRefresh);
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => {
      window.removeEventListener("onyx:documents-refresh", onRefresh);
      window.clearInterval(timer);
    };
  }, [load]);

  async function retry(doc: ProcessingDoc, password?: string) {
    setBusyId(doc.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(password ? { password } : {}),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok && res.status !== 202 && res.status !== 409) {
        setNotice(plainLanguageError(data.error) ?? data.error ?? "Retry failed.");
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function acknowledge(doc: ProcessingDoc) {
    setBusyId(doc.id);
    try {
      await fetch(`/api/documents/${encodeURIComponent(doc.id)}/acknowledge-partial`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const visible = docs.filter((doc) => processingStage(doc) !== "Complete" || takeoffBlockReason(doc));
  if (docs.length === 0) return null;

  return (
    <section className="mx-4 mt-4 rounded-xl border border-white/10 bg-[#16161A] sm:mx-6 lg:mx-10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">
          Plan processing
          {visible.length > 0 ? ` · ${visible.length} need attention` : " · all files complete"}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-white/40">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-white/5 border-t border-white/10">
          {notice && <li className="px-4 py-2 text-[11px] text-[#E50914]">{notice}</li>}
          {docs.map((doc) => {
            const stage = processingStage(doc);
            const error = plainLanguageError(doc.last_error, doc.last_error_step);
            const stall = processingStall(doc);
            const missing = listedMissingPages(doc);
            const measureNote = sheetMeasureNote(doc);
            const block = measureNote ?? takeoffBlockReason(doc);
            const needsPassword = stage === "Failed" && isPasswordRequired(doc.last_error);
            const loadedPages = pageNumbers[doc.id];
            const ledger = loadedPages
              ? buildPageLedger({
                  pageCount: doc.page_count,
                  pages: loadedPages,
                  missingPageNumbers: missing,
                })
              : [];
            const counts = ledgerCounts(ledger);
            return (
              <li key={doc.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs text-white">{doc.file_name}</div>
                  <div className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${STAGE_TONE[stage]}`}>{stage}</div>
                  {stall && <p className="mt-1 max-w-xl text-[11px] text-[#F5A623]">{stall}</p>}
                  {error && stage !== "Complete" && <p className="mt-1 max-w-xl text-[11px] text-white/60">{error}</p>}
                  {ledger.length > 0 && (
                    <p className="mt-1 text-[11px] text-white/45">
                      {counts.parsed} parsed · {counts.failed} failed · {counts.missing} missing · {counts.unread} unread
                    </p>
                  )}
                  {missing.length > 0 && <p className="mt-1 text-[11px] text-[#F5A623]">Missing pages: {missing.join(", ")}</p>}
                  {block && <p className="mt-1 text-[11px] text-white/45">{block}</p>}
                  {needsPassword && (
                    <form
                      className="mt-2 flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void retry(doc, passwords[doc.id] ?? "");
                      }}
                    >
                      <input
                        type="password"
                        value={passwords[doc.id] ?? ""}
                        onChange={(event) => setPasswords((prev) => ({ ...prev, [doc.id]: event.target.value }))}
                        placeholder="PDF password"
                        className="h-8 rounded border border-white/15 bg-black/40 px-2 text-xs text-white"
                      />
                      <button type="submit" disabled={busyId === doc.id} className="h-8 rounded bg-[#CCFF00] px-3 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-40">
                        Unlock
                      </button>
                    </form>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {stage === "Partial" && !partialWasAcknowledged(doc.meta) && (
                    <button type="button" onClick={() => void acknowledge(doc)} disabled={busyId === doc.id} className="text-[10px] uppercase tracking-widest text-[#F5A623]">
                      Continue without failed pages
                    </button>
                  )}
                  {(stage === "Failed" || stage === "Partial") && !needsPassword && (
                    <button type="button" onClick={() => void retry(doc)} disabled={busyId === doc.id} className="text-[10px] uppercase tracking-widest text-[#00D2FF]">
                      {busyId === doc.id ? "Retrying…" : "Retry"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-[10px] uppercase tracking-widest text-white/40"
                    onClick={() => {
                      const next = openDocId === doc.id ? null : doc.id;
                      setOpenDocId(next);
                      if (next && !pageNumbers[doc.id]) {
                        void fetch(`/api/documents/${encodeURIComponent(doc.id)}/pages`)
                          .then((res) => res.json())
                          .then((data: { pages?: Array<{ page_number: number; status?: string | null; error?: string | null }> }) => {
                            setPageNumbers((prev) => ({
                              ...prev,
                              [doc.id]: (data.pages ?? []).map((page) => ({
                                pageNumber: page.page_number,
                                failed: page.status === "error",
                                error: page.error,
                              })),
                            }));
                          })
                          .catch(() => undefined);
                      }
                    }}
                  >
                    {openDocId === doc.id ? "Hide pages" : "Pages"}
                  </button>
                </div>
                </div>
                {openDocId === doc.id && ledger.length > 0 && (
                  <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
                    {ledger.slice(0, 40).map((page) => (
                      <li key={page.pageNumber} className="rounded border border-white/5 px-2 py-1 text-[10px] text-white/60" title={page.detail ?? ""}>
                        p.{page.pageNumber} · {page.outcome}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
