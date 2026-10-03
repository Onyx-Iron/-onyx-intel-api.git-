"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FolderOpen, FileText, X, RefreshCw, Sparkles, Send, Upload, ChevronDown, ChevronRight } from "lucide-react";
import GoogleDrivePicker from "./GoogleDrivePicker";
import EmailImportPanel from "./EmailImportPanel";
import CloudImportPanel from "./CloudImportPanel";
import GenerateDocDropdown from "@/components/common/GenerateDocDropdown";

import { useToast } from "@/components/common/Toast";
import { uploadDocumentDirect } from "@/lib/documents/browser-upload";
import {
  isInFlightStatus,
  isRetryable,
  isTerminalSuccess,
  needsSplitStatusPoll,
  statusLabel,
} from "@/lib/documents/status";
import { PipelineStage, type PipelineStatus } from "@/components/documents/PipelineStage";

interface ParsedPage {
  page_number: number;
  summary: string;
  key_terms: string[];
}

interface SavedQuestion {
  id: string;
  question: string;
  answer: string;
  asked_at: string;
}

type DocStatus =
  | "pending"
  | "processing"
  | "split"
  | "queued"
  | "ready"
  | "complete"
  | "done"
  | "failed"
  | "complete_with_errors"
  | "error";

type SplitStatus = "pending" | "processing" | "done" | "error" | "skipped";

type DocType = "drawing" | "spec" | "rfi" | "submittal" | "other" | null;

interface Document {
  id: string;
  file_name: string;
  status: DocStatus;
  split_status?: SplitStatus | null;
  ocr_status?: PipelineStatus | null;
  vector_status?: PipelineStatus | null;
  takeoff_status?: PipelineStatus | null;
  last_error?: string | null;
  last_error_step?: string | null;
  doc_type: DocType;
  page_count: number | null;
  uploaded_at: string | null;
  processed_at: string | null;
  meta: Record<string, unknown> | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending:               "bg-white/5 text-gray-500 border-white/10",
  processing:            "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  split:                 "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  queued:                "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  ready:                 "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  complete:              "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  done:                  "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  complete_with_errors:  "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/20",
  error:                 "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  failed:                "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

const DOC_TYPE_STYLES: Record<string, string> = {
  drawing:   "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  spec:      "bg-purple-500/10 text-purple-400 border-purple-500/20",
  rfi:       "bg-orange-500/10 text-orange-400 border-orange-500/20",
  submittal: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  other:     "bg-white/5 text-gray-500 border-white/10",
};

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const color =
    ext === "pdf" ? "text-[#E50914]" :
    ["dwg", "dxf"].includes(ext) ? "text-[#00D2FF]" :
    ["tiff", "tif", "jpg", "jpeg", "png"].includes(ext) ? "text-[#CCFF00]" :
    "text-gray-500";
  return <FileText size={13} className={color} />;
}

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function documentHasAskableSource(doc: Document): boolean {
  if (!doc.file_name.toLowerCase().endsWith(".pdf")) return false;
  const m = doc.meta ?? {};
  return !!(m.storage_path || m.drive_file_id);
}

function SkeletonRows() {
  return (
    <>
      {[...Array(3)].map((_, i) => (
        <tr key={i}>
          {[...Array(5)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "55%" : "40%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DocumentsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [driveImporting, setDriveImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [askDoc, setAskDoc] = useState<{ id: string; name: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [pagesByDoc, setPagesByDoc] = useState<Record<string, { loading: boolean; pages: ParsedPage[]; questions: SavedQuestion[]; classification?: Record<string, string>; error?: string }>>({});

  const loadInsights = useCallback(async (docId: string) => {
    setPagesByDoc((prev) => ({ ...prev, [docId]: { loading: true, pages: prev[docId]?.pages ?? [], questions: prev[docId]?.questions ?? [], classification: prev[docId]?.classification } }));
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/pages`);
      const data = await res.json() as { pages?: ParsedPage[]; questions?: SavedQuestion[]; classification?: Record<string, string>; error?: string };
      if (!res.ok) {
        setPagesByDoc((prev) => ({ ...prev, [docId]: { loading: false, pages: [], questions: [], error: data.error ?? `HTTP ${res.status}` } }));
        return;
      }
      setPagesByDoc((prev) => ({ ...prev, [docId]: { loading: false, pages: data.pages ?? [], questions: data.questions ?? [], classification: data.classification ?? {} } }));
    } catch (err) {
      setPagesByDoc((prev) => ({ ...prev, [docId]: { loading: false, pages: [], questions: [], error: err instanceof Error ? err.message : String(err) } }));
    }
  }, []);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAtRef = useRef<number | null>(null);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const eventSourceRef = useRef<EventSource | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"off" | "connecting" | "live" | "fallback">("off");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stop watching after this many ms if status still hasn't changed —
  // a stuck "processing" usually means the fire-and-forget ingest crashed
  // before it could update the row to "error".
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;
  // Slow safety poll when SSE is live — still kicks split-status workers.
  const SAFETY_POLL_MS = 20_000;

  const toggleInsights = useCallback(async (docId: string) => {
    if (expandedDocId === docId) {
      setExpandedDocId(null);
      return;
    }
    setExpandedDocId(docId);
    if (!pagesByDoc[docId]) await loadInsights(docId);
  }, [expandedDocId, pagesByDoc, loadInsights]);

  const pollSplitStatus = useCallback(async (docs: Document[]) => {
    const asyncDocs = docs.filter(needsSplitStatusPoll);
    await Promise.all(
      asyncDocs.map(async (doc) => {
        try {
          await fetch(
            `/api/takeoff/split-status?document_id=${encodeURIComponent(doc.id)}`,
            { cache: "no-store" },
          );
        } catch {
          /* best effort — list refresh picks up finalized status */
        }
      }),
    );
  }, []);

  const [docsPage, setDocsPage] = useState(1);
  const [docsHasMore, setDocsHasMore] = useState(false);

  const loadDocuments = useCallback(async (showLoading = true, page = 1): Promise<Document[]> => {
    if (showLoading && page === 1) setLoading(true);
    try {
      const r = await fetch(`/api/documents?project_id=${encodeURIComponent(projectId)}&page=${page}&limit=200`);
      const d = await r.json() as { documents?: Document[]; pagination?: { hasMore?: boolean } };
      const incoming = d.documents ?? [];
      let next = incoming;
      setDocuments((prev) => {
        if (page === 1) {
          const incomingIds = new Set(incoming.map((doc) => doc.id));
          next = [...incoming, ...prev.filter((doc) => !incomingIds.has(doc.id))];
          return next;
        }
        const seen = new Set(prev.map((doc) => doc.id));
        next = [...prev, ...incoming.filter((doc) => !seen.has(doc.id))];
        return next;
      });
      setDocsHasMore(Boolean(d.pagination?.hasMore));
      setDocsPage(page);
      setLoading(false);
      return next;
    } catch {
      setLoading(false);
      return [];
    }
  }, [projectId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const hasInFlightDocs = documents.some(
    (d) => isInFlightStatus(d.status) || needsSplitStatusPoll(d),
  );

  // Prefer SSE status stream while docs are in-flight; fall back to interval
  // polling if EventSource fails. Split-status kicks still run on a slow
  // safety timer because those endpoints have finalize side effects.
  // Depend on the boolean (not `documents`) so SSE merges do not reconnect.
  useEffect(() => {
    if (!hasInFlightDocs || pollTimedOut) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      pollStartedAtRef.current = null;
      setLiveStatus("off");
      if (!hasInFlightDocs && pollTimedOut) setPollTimedOut(false);
      return;
    }

    let cancelled = false;
    let mode: "sse" | "fallback" = "sse";
    let safetyTimer: ReturnType<typeof setInterval> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;
    if (!pollStartedAtRef.current) pollStartedAtRef.current = Date.now();
    setLiveStatus("connecting");

    const timedOut = () => {
      const startedAt = pollStartedAtRef.current ?? Date.now();
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setPollTimedOut(true);
        return true;
      }
      return false;
    };

    const mergeDocuments = (incoming: Document[]) => {
      setDocuments((prev) => {
        const byId = new Map(prev.map((doc) => [doc.id, doc]));
        for (const doc of incoming) {
          const existing = byId.get(doc.id);
          byId.set(doc.id, existing ? { ...existing, ...doc } : doc);
        }
        const seen = new Set(incoming.map((doc) => doc.id));
        return [
          ...incoming.map((doc) => byId.get(doc.id)!),
          ...prev.filter((doc) => !seen.has(doc.id)),
        ];
      });
    };

    const startFallbackPoll = () => {
      if (cancelled || mode === "fallback") return;
      mode = "fallback";
      setLiveStatus("fallback");
      if (es) {
        es.close();
        es = null;
        eventSourceRef.current = null;
      }
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        void (async () => {
          if (cancelled || timedOut()) return;
          await pollSplitStatus(documentsRef.current);
          await loadDocuments(false);
        })();
      }, 4000);
      pollRef.current = fallbackTimer;
    };

    es = new EventSource(
      `/api/documents/events?project_id=${encodeURIComponent(projectId)}`,
    );
    eventSourceRef.current = es;
    es.addEventListener("documents", (ev) => {
      if (cancelled || timedOut()) return;
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as { documents?: Document[] };
        if (payload.documents) mergeDocuments(payload.documents);
        if (mode === "sse") setLiveStatus("live");
      } catch {
        /* ignore malformed frames */
      }
    });
    es.addEventListener("timeout", () => startFallbackPoll());
    es.onerror = () => startFallbackPoll();

    safetyTimer = setInterval(() => {
      void (async () => {
        if (cancelled || timedOut() || mode !== "sse") return;
        await pollSplitStatus(documentsRef.current);
      })();
    }, SAFETY_POLL_MS);

    return () => {
      cancelled = true;
      if (safetyTimer) clearInterval(safetyTimer);
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (pollRef.current === fallbackTimer) pollRef.current = null;
      if (es) es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    };
  }, [
    hasInFlightDocs,
    loadDocuments,
    pollSplitStatus,
    pollTimedOut,
    POLL_TIMEOUT_MS,
    SAFETY_POLL_MS,
    projectId,
  ]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    try {
      // Direct-to-Supabase signed PUT / TUS — no Google Drive required; bytes
      // never touch Vercel's 4.5MB limit. Large PDFs complete via
      // upload-url/complete → ingest → page-split-worker. "From Drive" stays
      // the Drive import path.
      await uploadDocumentDirect(file, projectId);
      toast({ title: String(`Uploaded ${file.name}`), kind: "info" });
      setPollTimedOut(false);
      await loadDocuments(false);
    } catch (err) {
      toast({ title: String(`Upload failed: ${err instanceof Error ? err.message : String(err)}`), kind: "error" });
    } finally {
      setUploading(false);
    }
  }, [projectId, loadDocuments, toast]);

  const handleDriveFiles = useCallback(async (
    driveFiles: { id: string; name: string; mimeType: string; sizeBytes?: number }[],
    accessToken: string,
  ) => {
    setDriveImporting(true);
    const failures: string[] = [];
    try {
      // accessToken is intentionally unused — server uses the stored OAuth token
      void accessToken;
      await Promise.all(
        driveFiles.map(async (f) => {
          try {
            // Unified endpoint inserts the row and auto-fires ingest
            const regRes = await fetch("/api/documents/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storage_type: "drive",
                project_id: projectId,
                file_name: f.name,
                drive_file_id: f.id,
                mime_type: f.mimeType,
                size: f.sizeBytes,
              }),
            });
            if (!regRes.ok) {
              const d = await regRes.json().catch(() => ({})) as { error?: string };
              failures.push(`${f.name}: ${d.error ?? regRes.status}`);
              return;
            }
          } catch (err) {
            failures.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );

      loadDocuments();
      if (failures.length) {
        toast({ title: String(`Couldn't import ${failures.length} file(s) from Drive:\n\n${failures.join("\n")}`), kind: "info" });
      }
    } finally {
      setDriveImporting(false);
    }
  }, [projectId, loadDocuments, toast]);

  const openAsk = (doc: Document) => {
    setAskDoc({ id: doc.id, name: doc.file_name });
    setQuestion("");
    setAnswer(null);
  };

  const submitAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askDoc || !question.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/documents/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: askDoc.id, question }),
      });
      const d = await res.json() as { answer?: string; error?: string };
      setAnswer(res.ok ? (d.answer ?? "(no answer)") : `Error: ${d.error ?? res.status}`);
      // Refresh persisted Q&A in the Insights cache so it survives panel close
      if (res.ok && askDoc) {
        void loadInsights(askDoc.id);
      }
    } catch (err) {
      setAnswer(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAsking(false);
    }
  };

  const deleteDocument = useCallback(async (id: string) => {
    setDeletingDocId(id);
    try {
      await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (askDoc?.id === id) setAskDoc(null);
    } finally {
      setDeletingDocId(null);
    }
  }, [askDoc]);

  const retryIngest = useCallback(async (doc: Document) => {
    if (retryingDocId) return;
    if (!documentHasAskableSource(doc)) {
      toast({ title: String("No stored file to retry — re-upload this document."), kind: "error" });
      return;
    }
    setRetryingDocId(doc.id);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
        queued?: boolean;
      };
      if (!res.ok && res.status !== 409 && res.status !== 202) {
        toast({ title: String(data.error ?? `Retry failed (${res.status})`), kind: "error" });
        return;
      }
      if (data.skipped && data.reason === "already_complete") {
        toast({ title: String("Document is already processed."), kind: "info" });
      } else if (
        data.skipped
        && (data.reason === "already_processing" || data.reason === "concurrent_claim")
      ) {
        toast({ title: String("Document is already being processed."), kind: "info" });
      } else if (res.status === 409 && data.skipped) {
        toast({ title: String("Document is already being processed."), kind: "info" });
      } else {
        toast({
          title: data.queued
            ? `${doc.file_name} re-queued for page-split.`
            : `${doc.file_name} ingest restarted.`,
          kind: "success",
        });
        // Optimistically flip so polling resumes immediately.
        setDocuments((prev) => prev.map((d) => (
          d.id === doc.id
            ? { ...d, status: data.queued ? "queued" : "processing", last_error: null, last_error_step: null }
            : d
        )));
      }
      setPollTimedOut(false);
      await loadDocuments(false);
    } catch (err) {
      toast({ title: String(`Retry failed: ${err instanceof Error ? err.message : String(err)}`), kind: "error" });
    } finally {
      setRetryingDocId(null);
    }
  }, [retryingDocId, loadDocuments, toast]);

  return (
    <div className="space-y-3">
      {pollTimedOut && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/5 px-4 py-3 text-[11px] text-[#E50914]">
          <div className="flex items-center justify-between gap-3">
            <span>
              One or more documents have been stuck in &ldquo;Processing&rdquo; for over 5 minutes. The background ingest likely failed silently — try deleting and re-uploading, or click Refresh.
            </span>
            <button
              onClick={() => { setPollTimedOut(false); loadDocuments(); }}
              className="flex items-center gap-1.5 rounded border border-[#E50914]/30 px-2 py-1 uppercase tracking-widest font-bold hover:bg-[#E50914]/10"
            >
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-white/10 bg-[#16161A] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FolderOpen size={12} className="text-[#00D2FF]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Documents</span>
            {liveStatus === "live" && (
              <span className="text-[9px] uppercase tracking-widest text-[#CCFF00]/80">Live</span>
            )}
            {liveStatus === "fallback" && (
              <span className="text-[9px] uppercase tracking-widest text-white/40">Polling</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.dwg,.dxf,.tiff,.tif,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`flex items-center gap-2 border rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase transition-colors ${
                uploading
                  ? "bg-white/5 border-white/10 text-gray-600 cursor-wait"
                  : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Upload size={12} />
              {uploading ? "Uploading…" : "Upload File"}
            </button>
            <EmailImportPanel
              projectId={projectId}
              onImported={loadDocuments}
              disabled={uploading || driveImporting}
            />
            <CloudImportPanel
              projectId={projectId}
              onImported={loadDocuments}
              disabled={uploading || driveImporting}
            />
            <GoogleDrivePicker onFilesSelected={handleDriveFiles} disabled={driveImporting}>
              <span className={`flex items-center gap-2 border rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase transition-colors ${
                driveImporting
                  ? "bg-white/5 border-white/10 text-gray-600 cursor-wait"
                  : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white cursor-pointer"
              }`}>
                <svg width="12" height="12" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                  <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                  <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                  <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                  <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                </svg>
                {driveImporting ? "Importing…" : "From Drive"}
              </span>
            </GoogleDrivePicker>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">File</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Type</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Status</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-right">Pages</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Uploaded</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows />
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-[10px] uppercase tracking-widest text-gray-600">
                    No documents yet. Click &ldquo;Upload File&rdquo; or &ldquo;From Drive&rdquo; to add a PDF.
                  </td>
                </tr>
              ) : (
                documents.flatMap((doc) => {
                  const statusKey = doc.status in STATUS_STYLES ? doc.status : "pending";
                  const isProcessing = isInFlightStatus(doc.status)
                    || doc.split_status === "pending"
                    || doc.split_status === "processing";
                  const isReady = isTerminalSuccess(doc.status);
                  const isExpanded = expandedDocId === doc.id;
                  const insights = pagesByDoc[doc.id];
                  return [
                    <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isReady ? (
                            <button
                              onClick={() => toggleInsights(doc.id)}
                              aria-label={isExpanded ? "Hide AI insights" : "Show AI insights"}
                              className="min-h-[40px] text-gray-600 hover:text-[#CCFF00] transition-colors"
                              title={isExpanded ? "Hide AI insights" : "Show AI insights"}
                            >
                              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          ) : <span className="w-[13px]" />}
                          <FileIcon name={doc.file_name} />
                          <div className="min-w-0">
                            <span className="text-xs text-white font-medium truncate max-w-[200px] block">{doc.file_name}</span>
                            {Boolean((doc.meta as Record<string, unknown> | null)?.title) && (
                              <span className="text-[9px] text-gray-600 truncate max-w-[200px] block">
                                {String((doc.meta as Record<string, unknown>).title)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {doc.doc_type ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${DOC_TYPE_STYLES[doc.doc_type] ?? DOC_TYPE_STYLES.other}`}>
                            {doc.doc_type}
                          </span>
                        ) : (
                          <span className="text-gray-700 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[statusKey]}`}>
                          {isProcessing && <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF] animate-pulse" />}
                          {statusLabel(doc.status)}
                        </span>
                        {(doc.split_status || doc.ocr_status || doc.takeoff_status) && (
                          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                            <PipelineStage label="Split" status={doc.split_status ?? null} />
                            <PipelineStage label="OCR" status={doc.ocr_status ?? null} />
                            <PipelineStage label="Takeoff" status={doc.takeoff_status ?? null} />
                          </div>
                        )}
                        {doc.last_error && (
                          <p className="mt-1 max-w-[14rem] truncate text-[9px] text-[#E50914]" title={doc.last_error}>
                            {doc.last_error_step ? `${doc.last_error_step}: ` : ""}{doc.last_error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                        {doc.page_count != null ? doc.page_count : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-[11px]">{fmt(doc.uploaded_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {doc.file_name.toLowerCase().endsWith(".pdf") && (
                            <Link
                              href={`/dashboard/projects/${projectId}/takeoff/canvas?document_id=${encodeURIComponent(doc.id)}`}
                              className="text-[10px] uppercase tracking-widest font-mono text-gray-600 hover:text-[#CCFF00] transition-colors"
                            >
                              Canvas
                            </Link>
                          )}
                          {documentHasAskableSource(doc) && (
                            <button
                              onClick={() => openAsk(doc)}
                              className="flex items-center gap-1.5 text-gray-600 hover:text-[#CCFF00] transition-colors"
                              title="Ask this document"
                            >
                              <Sparkles size={12} />
                              <span className="text-[10px] uppercase tracking-widest font-mono">Ask</span>
                            </button>
                          )}
                          {(isRetryable(doc.status) || (pollTimedOut && isProcessing)) && (
                            <button
                              onClick={() => void retryIngest(doc)}
                              disabled={retryingDocId === doc.id}
                              className="flex items-center gap-1.5 text-gray-600 hover:text-[#00D2FF] transition-colors disabled:opacity-40"
                              title="Retry ingest / page-split"
                            >
                              <RefreshCw size={12} className={retryingDocId === doc.id ? "animate-spin" : undefined} />
                              <span className="text-[10px] uppercase tracking-widest font-mono">
                                {retryingDocId === doc.id ? "Retrying…" : "Retry"}
                              </span>
                            </button>
                          )}
                          <button
                            onClick={() => deleteDocument(doc.id)}
                            disabled={deletingDocId === doc.id}
                            aria-label="Delete document"
                            className="min-h-[40px] text-gray-700 hover:text-[#E50914] transition-colors disabled:opacity-30"
                            title="Delete document"
                          >
                            {deletingDocId === doc.id ? (
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>,
                    isExpanded ? (
                      <tr key={`${doc.id}-insights`} className="bg-[#0A0A0B]">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2">
                              <Sparkles size={11} className="text-[#CCFF00]" />
                              <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">AI Insights — per page</span>
                              <span className="text-[10px] text-gray-700">
                                {insights?.pages?.length ?? 0} of {doc.page_count ?? "?"} pages
                              </span>
                            </div>
                            <GenerateDocDropdown
                              projectId={projectId}
                              sourceDocumentId={doc.id}
                              label="Generate from this plan"
                            />
                          </div>
                          {insights?.classification && Object.keys(insights.classification).length > 0 && (
                            <div className="mb-4">
                              <p className="text-[9px] uppercase tracking-widest text-gray-500 font-bold mb-2">Classification</p>
                              <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                                {Object.entries(insights.classification).map(([label, value]) => (
                                  <div key={label}>
                                    <dt className="text-[9px] uppercase tracking-widest text-gray-700">{label}</dt>
                                    <dd className="text-[11px] text-white/85 font-mono">{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}
                          {insights?.questions && insights.questions.length > 0 && (
                            <div className="mb-4">
                              <p className="text-[9px] uppercase tracking-widest text-gray-500 font-bold mb-2">Saved Q&amp;A</p>
                              <div className="space-y-2">
                                {insights.questions.map((q) => (
                                  <div key={q.id} className="rounded-lg border border-[#CCFF00]/15 bg-[#CCFF00]/[0.03] p-3">
                                    <p className="text-[11px] font-semibold text-white/90">{q.question}</p>
                                    <pre className="mt-1.5 text-[11px] leading-relaxed text-white/65 whitespace-pre-wrap font-sans">{q.answer}</pre>
                                    {q.asked_at && (
                                      <p className="mt-1.5 text-[9px] uppercase tracking-widest text-gray-700">
                                        {new Date(q.asked_at).toLocaleString()}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {!insights || insights.loading ? (
                            <div className="space-y-2">
                              {[...Array(3)].map((_, i) => (
                                <div key={i} className="h-12 bg-white/5 animate-pulse rounded-lg" />
                              ))}
                            </div>
                          ) : insights.error ? (
                            <p className="text-[11px] text-[#E50914]">Could not load insights: {insights.error}</p>
                          ) : insights.pages.length === 0 ? (
                            (insights.classification && Object.keys(insights.classification).length > 0) || (insights.questions?.length ?? 0) > 0 ? null : (
                              <p className="text-[11px] text-gray-600 uppercase tracking-widest">
                                Document is ready but no per-page summaries were saved. Re-ingest may help.
                              </p>
                            )
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {insights.pages.map((p) => (
                                <div key={p.page_number} className="rounded-lg border border-white/8 bg-[#0E0F12] p-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#CCFF00]">Page {p.page_number}</span>
                                    {documentHasAskableSource(doc) && (
                                      <button
                                        onClick={() => openAsk(doc)}
                                        className="text-[9px] uppercase tracking-widest text-gray-600 hover:text-[#CCFF00] transition-colors"
                                      >
                                        Ask →
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-[11px] leading-relaxed text-white/75">{p.summary || <span className="text-gray-700 italic">No summary</span>}</p>
                                  {p.key_terms.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {p.key_terms.slice(0, 6).map((t) => (
                                        <span key={t} className="text-[9px] font-mono text-gray-500 bg-white/5 border border-white/8 rounded px-1.5 py-0.5">
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })
              )}
            </tbody>
          </table>
          {docsHasMore && (
            <div className="flex justify-center border-t border-white/5 py-3">
              <button
                type="button"
                onClick={() => { void loadDocuments(false, docsPage + 1); }}
                className="text-[10px] uppercase tracking-widest font-mono text-gray-500 hover:text-[#CCFF00]"
              >
                Load more documents
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Document Q&A */}
      {askDoc && (
        <div className="rounded-xl border border-[#CCFF00]/20 bg-[#16161A] p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={12} className="text-[#CCFF00]" />
              <span className="text-[11px] uppercase tracking-widest text-gray-400">Ask</span>
              <span className="text-xs text-white font-medium truncate">{askDoc.name}</span>
            </div>
            <button onClick={() => setAskDoc(null)} aria-label="Close ask panel" className="min-h-[40px] text-gray-600 hover:text-white">
              <X size={14} />
            </button>
          </div>
          <form onSubmit={submitAsk} className="flex items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What is the specified concrete strength? Which sheet shows the foundation plan?"
              className="flex-1 bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
            />
            <button
              type="submit"
              disabled={!question.trim() || asking}
              aria-label="Send question"
              className="w-9 h-9 rounded-lg bg-[#CCFF00]/10 border border-[#CCFF00]/30 flex items-center justify-center text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-30 transition-colors"
            >
              <Send size={14} />
            </button>
          </form>
          {asking && (
            <p className="text-[11px] text-[#00D2FF] mt-3 font-mono uppercase tracking-widest">
              Reading document…
            </p>
          )}
          {answer && (
            <pre className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap font-sans mt-3 bg-[#0A0A0B] border border-white/5 rounded-lg p-3 max-h-80 overflow-y-auto">
              {answer}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
