"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";
import { FolderOpen, FileText, X, RefreshCw, Sparkles, Send, Upload, ChevronDown, ChevronRight } from "lucide-react";
import GoogleDrivePicker from "./GoogleDrivePicker";
import GoogleConnect from "@/components/google/GoogleConnect";
import GenerateDocDropdown from "@/components/common/GenerateDocDropdown";

import { useToast } from "@/components/common/Toast";
import { fetchWithRetry } from "@/lib/network/retry";

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

type DocStatus = "pending" | "processing" | "ready" | "complete" | "error";

type DocType = "drawing" | "spec" | "rfi" | "submittal" | "other" | null;

interface Document {
  id: string;
  file_name: string;
  status: DocStatus;
  doc_type: DocType;
  page_count: number | null;
  uploaded_at: string | null;
  processed_at: string | null;
  meta: Record<string, unknown> | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending:    "bg-white/5 text-gray-500 border-white/10",
  processing: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  ready:      "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  complete:   "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  error:      "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
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
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [askDoc, setAskDoc] = useState<{ id: string; name: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [pagesByDoc, setPagesByDoc] = useState<Record<string, { loading: boolean; pages: ParsedPage[]; questions: SavedQuestion[]; classification?: Record<string, string>; error?: string }>>({});
  const uploadAbortRef = useRef<AbortController | null>(null);
  const driveAbortRef = useRef<AbortController | null>(null);

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
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadViaSupabase = useCallback(async (file: File, signal?: AbortSignal) => {
    let documentId = "";
    try {
      const reserveRes = await fetchWithRetry("/api/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          file_name: file.name,
          size: file.size,
          content_type: file.type || "application/octet-stream",
        }),
        signal,
      }, { retries: 1 });
      const reservation = await reserveRes.json().catch(() => ({})) as {
        document_id?: string;
        upload?: { url?: string };
        error?: string;
      };
      if (!reserveRes.ok || !reservation.document_id || !reservation.upload?.url) {
        throw new Error(reservation.error ?? `Could not start ${file.name} upload (${reserveRes.status}).`);
      }
      documentId = reservation.document_id;

      const uploadRes = await fetch(reservation.upload.url, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "false",
        },
        body: file,
        signal,
      });
      if (!uploadRes.ok) {
        const detail = await uploadRes.text().catch(() => uploadRes.statusText);
        throw new Error(`Storage upload failed (${uploadRes.status}): ${detail.slice(0, 200)}`);
      }

      const finalizeRes = await fetchWithRetry("/api/documents/upload-url", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId }),
        signal,
      }, { retries: 1 });
      const finalized = await finalizeRes.json().catch(() => ({})) as { error?: string };
      if (!finalizeRes.ok) {
        throw new Error(finalized.error ?? `Could not finalize ${file.name} (${finalizeRes.status}).`);
      }
      return finalized;
    } catch (error) {
      if (documentId) {
        await fetch("/api/documents/upload-url", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: documentId }),
        }).catch(() => {});
      }
      throw error;
    }
  }, [projectId]);

  // Stop polling after this many ms if status still hasn't changed -
  // a stuck "processing" usually means the fire-and-forget ingest crashed
  // before it could update the row to "error".
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;

  const toggleInsights = useCallback(async (docId: string) => {
    if (expandedDocId === docId) {
      setExpandedDocId(null);
      return;
    }
    setExpandedDocId(docId);
    if (!pagesByDoc[docId]) await loadInsights(docId);
  }, [expandedDocId, pagesByDoc, loadInsights]);

  const loadDocuments = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(null);
    fetch(`/api/documents?project_id=${encodeURIComponent(projectId)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : `Could not load documents (${r.status}). Refresh and try again.`);
        }
        return data;
      })
      .then((d: unknown) => {
        const data = d as { documents?: Document[] };
        setDocuments(data.documents ?? []);
        setPollTimedOut(false);
        setLoading(false);
      })
      .catch((err) => {
        setDocuments([]);
        setLoadError(err instanceof Error ? err.message : "Could not load documents. Refresh and try again.");
        setLoading(false);
      });
  }, [projectId]);

  useProjectSyncRefresh(() => loadDocuments(false));

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Poll while any doc is still processing - but give up after POLL_TIMEOUT_MS
  // so a silently-crashed background ingest doesn't spin forever.
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === "processing" || d.status === "pending");
    if (hasProcessing && !pollTimedOut) {
      if (!pollRef.current) {
        pollStartedAtRef.current = Date.now();
        pollRef.current = setInterval(() => {
          const startedAt = pollStartedAtRef.current ?? Date.now();
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setPollTimedOut(true);
            return;
          }
          loadDocuments(false);
        }, 4000);
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      pollStartedAtRef.current = null;
      // Reset the timed-out flag once nothing is processing anymore
      if (!hasProcessing && pollTimedOut) setPollTimedOut(false);
    }
    return () => {
      // Cleanup on unmount: clear interval so no setState fires on a dead component
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      pollStartedAtRef.current = null;
    };
  }, [documents, loadDocuments, pollTimedOut, POLL_TIMEOUT_MS]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    const ctrl = new AbortController();
    uploadAbortRef.current = ctrl;
    try {
      await uploadViaSupabase(file, ctrl.signal);
      loadDocuments();
      toast({ title: "Upload complete", description: `${file.name} is processing now.`, kind: "success" });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        toast({ title: "Upload canceled.", kind: "info" });
        return;
      }
      console.error("[documents/upload] failed", {
        projectId,
        fileName: file.name,
        message: err instanceof Error ? err.message : String(err),
      });
      toast({ title: String(`Upload failed: ${err instanceof Error ? err.message : String(err)}`), kind: "error" });
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
    }
  }, [loadDocuments, projectId, toast, uploadViaSupabase]);

  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  const handleDriveFiles = useCallback(async (
    driveFiles: { id: string; name: string; mimeType: string; sizeBytes?: number }[],
    accessToken: string,
  ) => {
    setDriveImporting(true);
    const ctrl = new AbortController();
    driveAbortRef.current = ctrl;
    const failures: string[] = [];
    try {
      // accessToken is intentionally unused - server uses the stored OAuth token
      void accessToken;
      await Promise.all(
        driveFiles.map(async (f) => {
          if (ctrl.signal.aborted) return;
          try {
            // Unified endpoint inserts the row and auto-fires ingest
            const regRes = await fetch("/api/documents/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: ctrl.signal,
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
            if ((err as { name?: string }).name === "AbortError") return;
            failures.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );

      loadDocuments();
      if (ctrl.signal.aborted) {
        toast({ title: "Drive import canceled.", kind: "info" });
        return;
      }
      if (failures.length) {
        toast({ title: String(`Couldn't import ${failures.length} file(s) from Drive:\n\n${failures.join("\n")}`), kind: "info" });
      } else if (driveFiles.length > 0) {
        toast({ title: `Imported ${driveFiles.length} file${driveFiles.length === 1 ? "" : "s"} from Drive.`, kind: "success" });
      }
    } finally {
      driveAbortRef.current = null;
      setDriveImporting(false);
    }
  }, [projectId, loadDocuments, toast]);

  const cancelDriveImport = useCallback(() => {
    driveAbortRef.current?.abort();
  }, []);

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
      setAnswer(res.ok ? (d.answer ?? "(no answer)") : `Could not answer that yet. Try a more specific question or reopen the document: ${d.error ?? res.status}`);
      // Refresh persisted Q&A in the Insights cache so it survives panel close
      if (res.ok && askDoc) {
        void loadInsights(askDoc.id);
      }
    } catch (err) {
      setAnswer(`Request failed: ${err instanceof Error ? err.message : String(err)}. Try again in a moment.`);
    } finally {
      setAsking(false);
    }
  };

  const deleteDocument = useCallback(async (id: string) => {
    setDeletingDocId(id);
    const prevDocuments = documents;
    try {
      const res = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setDocuments(prevDocuments);
        toast({ title: String(data.error ?? `Could not delete the document (${res.status}). Refresh the list and try again.`), kind: "error" });
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (askDoc?.id === id) setAskDoc(null);
      toast({ title: "Document deleted.", kind: "success" });
    } catch (err) {
      setDocuments(prevDocuments);
      toast({ title: String(err instanceof Error ? err.message : "Could not delete the document just now. Refresh the list and try again in a moment."), kind: "error" });
    } finally {
      setDeletingDocId(null);
    }
  }, [askDoc, documents, toast]);

  const retryDocument = useCallback(async (doc: Document) => {
    setDeletingDocId(doc.id);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        toast({ title: String(data.error ?? `Retry failed (${res.status}). The document may still be processing, so try again in a moment.`), kind: "error" });
        return;
      }
      toast({ title: `${doc.file_name} is retrying.`, kind: "success" });
      loadDocuments(false);
    } finally {
      setDeletingDocId(null);
    }
  }, [loadDocuments, toast]);

  const canAsk = (doc: Document) => {
    if (!doc.file_name.toLowerCase().endsWith(".pdf")) return false;
    const m = doc.meta ?? {};
    return !!(m.storage_path || m.drive_file_id);
  };

  const canRetry = (doc: Document) => {
    const m = doc.meta ?? {};
    return doc.status === "error" && Boolean(m.storage_path || m.drive_file_id);
  };

  return (
      <div className="space-y-3">
      {loadError && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-4 py-3 text-[11px] text-amber-200">
          <div className="font-semibold">Documents could not finish loading.</div>
          <div className="mt-1 text-amber-200/80">{loadError}</div>
          <button
            type="button"
            onClick={() => loadDocuments()}
            className="mt-3 inline-flex h-9 items-center rounded-full border border-amber-300/30 bg-amber-300/10 px-3 text-[11px] font-semibold uppercase tracking-widest text-amber-100 hover:bg-amber-300/20"
          >
            Try again
          </button>
        </div>
      )}
      {pollTimedOut && (
        <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/5 px-4 py-3 text-[11px] text-[#E50914]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              One or more documents have been stuck in &ldquo;Processing&rdquo; for over 5 minutes. The background ingest likely stalled. Refresh first, then re-upload if it still does not clear.
            </span>
            <button
              type="button"
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <GoogleConnect compact />
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
              {uploading ? "Uploading..." : "Upload File"}
            </button>
            {uploading && (
              <button
                onClick={cancelUpload}
                className="flex items-center gap-2 border rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase transition-colors bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
              >
                <X size={12} />
                Cancel
              </button>
            )}
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
                {driveImporting ? "Importing..." : "From Drive"}
              </span>
            </GoogleDrivePicker>
            {driveImporting && (
              <button
                onClick={cancelDriveImport}
                className="flex items-center gap-2 border rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase transition-colors bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
              >
                <X size={12} />
                Cancel
              </button>
            )}
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
                    No documents yet. Upload a file or use From Drive to add a plan, photo, or PDF.
                  </td>
                </tr>
              ) : (
                documents.flatMap((doc) => {
                  const statusKey = doc.status in STATUS_STYLES ? doc.status : "pending";
                  const isProcessing = doc.status === "processing";
                  const isReady = doc.status === "ready" || doc.status === "complete";
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
                          <span className="text-gray-700 text-[10px]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${STATUS_STYLES[statusKey]}`}>
                          {isProcessing && <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF] animate-pulse" />}
                          {isProcessing ? "Processing" : doc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                        {doc.page_count != null ? doc.page_count : "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-[11px]">{fmt(doc.uploaded_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {canAsk(doc) && (
                            <button
                              onClick={() => openAsk(doc)}
                              className="flex items-center gap-1.5 text-gray-600 hover:text-[#CCFF00] transition-colors"
                              title="Ask this document"
                            >
                              <Sparkles size={12} />
                              <span className="text-[10px] uppercase tracking-widest font-mono">Ask</span>
                            </button>
                          )}
                          {doc.status === "error" && canRetry(doc) && (
                            <button
                              onClick={() => void retryDocument(doc)}
                              className="flex items-center gap-1.5 text-gray-600 hover:text-[#00D2FF] transition-colors"
                              title="Retry"
                            >
                              <RefreshCw size={12} />
                              <span className="text-[10px] uppercase tracking-widest font-mono">Retry</span>
                            </button>
                          )}
                          {doc.status === "error" && !canRetry(doc) && (
                            <span className="text-[10px] uppercase tracking-widest font-mono text-gray-700">
                              Re-upload or reconnect Drive
                            </span>
                          )}
                          <button
                            onClick={() => setDeleteTarget(doc)}
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
                              <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Page notes</span>
                              <span className="text-[10px] text-gray-700">
                                {insights?.pages?.length ?? 0} of {doc.page_count ?? "?"} pages
                              </span>
                            </div>
                            <GenerateDocDropdown
                              projectId={projectId}
                              sourceDocumentId={doc.id}
                              label="Create from this document"
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
                            <p className="text-[11px] text-[#E50914]">Could not load insights. Try reopening the document or retrying the import: {insights.error}</p>
                          ) : insights.pages.length === 0 ? (
                            (insights.classification && Object.keys(insights.classification).length > 0) || (insights.questions?.length ?? 0) > 0 ? null : (
                              <p className="text-[11px] text-gray-600 uppercase tracking-widest">
                                Document is ready, but no page notes were saved yet. Try retrying the file import.
                              </p>
                            )
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {insights.pages.map((p) => (
                                <div key={p.page_number} className="rounded-lg border border-white/8 bg-[#0E0F12] p-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#CCFF00]">Page {p.page_number}</span>
                                    {canAsk(doc) && (
                                      <button
                                        onClick={() => openAsk(doc)}
                                        className="text-[9px] uppercase tracking-widest text-gray-600 hover:text-[#CCFF00] transition-colors"
                                      >
                                        Ask
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
              Reading document...
            </p>
          )}
          {answer && (
            <pre className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap font-sans mt-3 bg-[#0A0A0B] border border-white/5 rounded-lg p-3 max-h-80 overflow-y-auto">
              {answer}
            </pre>
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title="Delete document?"
          body={`This will remove "${deleteTarget.file_name}" from the document list. You can upload it again later, but this copy will be removed now.`}
          confirming={deletingDocId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await deleteDocument(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ConfirmDeleteModal({
  title,
  body,
  confirming,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0E0F12] p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">{title}</h3>
          <button type="button" onClick={onCancel} className="text-white/40 hover:text-white">✕</button>
        </div>
        <p className="text-sm leading-relaxed text-white/70">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={confirming}
            className="inline-flex h-9 items-center rounded-full bg-[#E50914] px-4 text-[11px] font-bold uppercase tracking-widest text-white hover:opacity-90 disabled:opacity-50"
          >
            {confirming ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}




