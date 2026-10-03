"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, FileText, X, RefreshCw, Sparkles, Send, Upload, ChevronDown, ChevronRight } from "lucide-react";
import GoogleDrivePicker from "./GoogleDrivePicker";
import GenerateDocDropdown from "@/components/common/GenerateDocDropdown";

import { useToast } from "@/components/common/Toast";

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

type DocStatus = "pending" | "processing" | "queued" | "split" | "ready" | "complete" | "done" | "error" | "failed" | "duplicate";

type DocType = "drawing" | "spec" | "rfi" | "submittal" | "other" | null;

interface Document {
  id: string;
  file_name: string;
  status: DocStatus;
  doc_type: DocType;
  page_count: number | null;
  uploaded_at: string | null;
  processed_at: string | null;
  last_error: string | null;
  meta: Record<string, unknown> | null;
}

const IN_PROGRESS_STATUSES = new Set(["pending", "processing", "queued", "split"]);
const READY_STATUSES = new Set(["ready", "complete", "done", "split"]);
const ERROR_STATUSES = new Set(["error", "failed"]);

const STATUS_STYLES: Record<string, string> = {
  pending:    "bg-white/5 text-gray-500 border-white/10",
  processing: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  queued:     "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  split:      "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  ready:      "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  complete:   "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  done:       "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  error:      "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  failed:     "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
  duplicate:  "bg-white/5 text-gray-500 border-white/10",
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
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stop polling after this many ms if status still hasn't changed —
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
    fetch(`/api/documents?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { documents?: Document[] };
        setDocuments(data.documents ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Poll while any doc is still processing — but give up after POLL_TIMEOUT_MS
  // so a silently-crashed background ingest doesn't spin forever.
  useEffect(() => {
    const hasProcessing = documents.some((d) => IN_PROGRESS_STATUSES.has(d.status));
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
    try {
      // Step 1: ask the unified upload endpoint for a Drive resumable upload URL
      const sessionRes = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_type: "drive", file_name: file.name, content_type: file.type || "application/octet-stream", size: file.size, project_id: projectId }),
      });
      const sessionData = await sessionRes.json() as { upload_url?: string; error?: string; code?: string };
      if (!sessionRes.ok) {
        if (sessionData.code === "NEED_GOOGLE") {
          toast({ title: String("Google Drive is not connected.\n\nClick \"From Drive\" to connect Google, then try uploading again."), kind: "error" });
        } else {
          toast({ title: String(sessionData.error ?? "Could not start upload"), kind: "error" });
        }
        return;
      }

      // Step 2: upload file bytes directly to Google Drive (bypasses Vercel + Supabase size limits)
      // Use an AbortController-backed timeout so a hung PUT doesn't leave the UI
      // stuck on "Uploading…" forever (e.g. Drive token expired between session
      // create and the PUT — Drive sometimes hangs the connection instead of 401-ing fast).
      const PUT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — large PDFs are slow on flaky links
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PUT_TIMEOUT_MS);
      let uploadRes: Response;
      try {
        uploadRes = await fetch(sessionData.upload_url!, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
          signal: ctrl.signal,
        });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          toast({ title: String(`Upload to Google Drive timed out after ${Math.round(PUT_TIMEOUT_MS / 60000)} minutes. The Google sign-in may have expired — click "From Drive" to reconnect Google, then try again.`), kind: "error" });
          return;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (!uploadRes.ok) {
        const detail = await uploadRes.text().catch(() => "");
        if (uploadRes.status === 401 || uploadRes.status === 403) {
          toast({ title: String(`Google Drive rejected the upload (${uploadRes.status}). Your Google sign-in likely expired between starting and finishing the upload. Click "From Drive" to reconnect Google, then try again.\n\n${detail.slice(0, 200)}`), kind: "error" });
        } else {
          toast({ title: String(`Upload to Google Drive failed (${uploadRes.status}): ${detail.slice(0, 200)}`), kind: "error" });
        }
        return;
      }
      const driveFile = await uploadRes.json() as { id?: string };
      const driveFileId = driveFile.id;
      if (!driveFileId) {
        toast({ title: String("Drive upload completed but did not return a file ID. Please try again."), kind: "error" });
        return;
      }

      // Step 3: register the document row via the unified endpoint
      // (the server auto-fires ingest — no separate call needed)
      const regRes = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_type: "drive", project_id: projectId, file_name: file.name, drive_file_id: driveFileId, mime_type: file.type, size: file.size }),
      });
      if (!regRes.ok) {
        const d = await regRes.json().catch(() => ({})) as { error?: string };
        toast({ title: String(d.error ?? "Registration failed"), kind: "error" });
        return;
      }

      loadDocuments();
    } catch (err) {
      toast({ title: String(`Upload failed: ${err instanceof Error ? err.message : String(err)}`), kind: "error" });
    } finally {
      setUploading(false);
    }
  }, [projectId, loadDocuments]);

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
  }, [projectId, loadDocuments]);

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

  const retryIngest = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        toast({ title: String(data.error ?? "Retry failed"), kind: "error" });
        return;
      }
      loadDocuments(false);
    } catch (err) {
      toast({ title: String(err instanceof Error ? err.message : String(err)), kind: "error" });
    }
  }, [loadDocuments, toast]);

  const canAsk = (doc: Document) => {
    if (!doc.file_name.toLowerCase().endsWith(".pdf")) return false;
    const m = doc.meta ?? {};
    return !!(m.storage_path || m.drive_file_id);
  };

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
                  const statusKey = doc.status in STATUS_STYLES ? doc.status : ERROR_STATUSES.has(doc.status) ? "error" : "pending";
                  const isProcessing = IN_PROGRESS_STATUSES.has(doc.status);
                  const isReady = READY_STATUSES.has(doc.status);
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
                          {isProcessing ? "Processing" : doc.status === "failed" ? "error" : doc.status}
                        </span>
                        {ERROR_STATUSES.has(doc.status) && doc.last_error && (
                          <span className="mt-1 block max-w-[180px] truncate text-[9px] text-[#E50914]" title={doc.last_error}>
                            {doc.last_error}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                        {doc.page_count != null ? doc.page_count : "—"}
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
                          {ERROR_STATUSES.has(doc.status) && (
                            <button
                              onClick={() => { void retryIngest(doc.id); }}
                              className="flex items-center gap-1.5 text-gray-600 hover:text-[#00D2FF] transition-colors"
                              title="Retry"
                            >
                              <RefreshCw size={12} />
                              <span className="text-[10px] uppercase tracking-widest font-mono">Retry</span>
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
                                    {canAsk(doc) && (
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
