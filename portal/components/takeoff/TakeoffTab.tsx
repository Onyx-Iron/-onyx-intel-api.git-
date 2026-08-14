"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getGoogleToken } from "@/lib/google/clientAuth";

import { useToast } from "@/components/common/Toast";
import GoogleConnect from "@/components/google/GoogleConnect";
import GoogleDrivePicker from "@/components/documents/GoogleDrivePicker";
import ScopePreflight from "@/components/takeoff/ScopePreflight";
import AutomatedTakeoffStatus from "@/components/takeoff/AutomatedTakeoffStatus";
import AutomatedTakeoffReview from "@/components/takeoff/AutomatedTakeoffReview";
import { fetchWithRetry } from "@/lib/network/retry";

// Types matching SecureTakeoffRow output from takeoff_validator.py

interface TakeoffRow {
  id?: string;
  trade: string;
  cost_code: string;       // format: "03-30-00"
  description: string;
  quantity_basis: string;
  total_qty: number;
  uom: string;
  drawing_ref?: string | null;
  location_tag?: string | null;
  quantity_evidence?: Record<string, unknown> | null;
  extraction_method?: "deterministic" | "ai_vision";
  page?: number | null;
  document_id?: string | null;
}

// Files routed to the deterministic Python extractor (no AI, zero cost).
const DETERMINISTIC_EXTS = [".pdf", ".dwg", ".dxf", ".ifc", ".xlsx", ".xls"];
const ALL_ACCEPT = ".json," + DETERMINISTIC_EXTS.join(",");

interface Coverage { [k: string]: number | string; }
interface AiPageRef { page_number: number; page_id: string; }

interface ChunkEvent {
  event: "CHUNK_PROCESSED";
  rows: TakeoffRow[];
  processed_count: number;
  total_rows: number;
  progress_pct: number;
  chunk_audit: { valid: number; errors: number };
}

interface StartedEvent  { event: "PARSING_STARTED";   total_rows: number; file: string; }
interface CompletedEvent{ event: "PARSING_COMPLETED"; final_row_count: number; failed_rows: number; audit_status: string; }
interface ErrorEvent    { event: "ROW_VALIDATION_ERROR" | "CRITICAL_PARSER_FAILURE"; message?: string; error_count?: number; }

type StreamEvent = ChunkEvent | StartedEvent | CompletedEvent | ErrorEvent;
type Phase = "idle" | "uploading" | "streaming" | "processing_async" | "done" | "error";

interface SavedTakeoffItem {
  id: string; label: string; csi_code: string | null; quantity: number | null;
  unit: string | null; page: number | null; meta: Record<string, unknown> | null;
}

// CSI division colour mapping

const CSI_COLORS: Record<string, string> = {
  "01": "#6366f1", "02": "#8b5cf6", "03": "#a855f7", "04": "#ec4899",
  "05": "#ef4444", "06": "#f97316", "07": "#f59e0b", "08": "#eab308",
  "09": "#84cc16", "10": "#22c55e", "11": "#10b981", "12": "#14b8a6",
  "22": "#06b6d4", "23": "#0ea5e9", "26": "#CCFF00", "27": "#00D2FF",
  "28": "#3b82f6", "31": "#8b5cf6", "32": "#f97316", "33": "#22c55e",
};

function divColor(costCode: string): string {
  return CSI_COLORS[costCode?.slice(0, 2) ?? "01"] ?? "#6b7280";
}

function formatQty(v: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
}

// Division summary

interface DivSummary { code: string; trade: string; count: number; qty: number; color: string; }

function buildDivisions(rows: TakeoffRow[]): DivSummary[] {
  const map = new Map<string, DivSummary>();
  for (const r of rows) {
    const key = r.cost_code?.slice(0, 2) ?? "00";
    if (!map.has(key)) map.set(key, { code: key, trade: r.trade, count: 0, qty: 0, color: divColor(r.cost_code) });
    const e = map.get(key)!;
    e.count += 1;
    e.qty += r.total_qty;
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

// Sub-components

function UploadZone({ onFile, disabled }: { onFile: (f: File) => void; disabled: boolean }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);

  const handle = useCallback((f: File | null | undefined) => {
    if (!f || disabled) return;
    const lower = f.name.toLowerCase();
    const ok = lower.endsWith(".json") || DETERMINISTIC_EXTS.some((e) => lower.endsWith(e));
    if (!ok) { toast({ title: String("Accepted: .pdf, .dxf/.dwg, .ifc, .xlsx, or a .json takeoff."), kind: "info" }); return; }
    onFile(f);
  }, [disabled, onFile, toast]);

  const importFromDrive = useCallback(
    async (
      files: Array<{ id: string; name: string; mimeType: string; sizeBytes?: number }>,
      accessToken: string,
    ) => {
      if (disabled) return;
      const picked = files[0];
      if (!picked) return;
      const lower = picked.name.toLowerCase();
      const ok = lower.endsWith(".json") || DETERMINISTIC_EXTS.some((e) => lower.endsWith(e));
      if (!ok) {
        toast({ title: String("Drive file must be .pdf, .dxf/.dwg, .ifc, .xlsx, or .json."), kind: "info" });
        return;
      }
      setImporting(true);
      try {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(picked.id)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) {
          throw new Error(`Drive returned ${res.status}`);
        }
        const blob = await res.blob();
        const file = new File([blob], picked.name, { type: picked.mimeType || blob.type });
        handle(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast({ title: String(`Couldn't import from Drive: ${msg}`), kind: "error" });
      } finally {
        setImporting(false);
      }
    },
    [disabled, toast, handle],
  );

  return (
    <div className="space-y-2">
      <div
        className={`border border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
          ${dragging
            ? "border-[#CCFF00]/40 bg-[#CCFF00]/[0.02]"
            : "border-white/10 hover:border-white/20 bg-[#0E0F12]"}
          ${disabled || importing ? "opacity-50 pointer-events-none" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
      >
        <input ref={inputRef} type="file" accept={ALL_ACCEPT} className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#CCFF00]/10 border border-[#CCFF00]/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-[#CCFF00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white tracking-wide">
              {importing ? "Importing from Drive..." : "Drop a drawing, model, or schedule"}
            </p>
            <p className="text-[11px] text-gray-600 mt-1">PDF · DXF/DWG · IFC · XLSX · JSON - or click to browse</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#CCFF00] animate-pulse inline-block" />
            <span className="text-[10px] text-gray-700 tracking-widest uppercase font-mono">
              Deterministic extraction · CSI MasterFormat · Zero per-doc cost
            </span>
          </div>
        </div>
      </div>

      {/* Import from Google Drive - sits below the drop zone, doesn't compete for
          attention but is one click away when the plans live in Drive. */}
      <div className="flex items-center justify-center gap-3 text-[11px] text-white/40">
        <span className="h-px flex-1 max-w-[100px] bg-white/10" />
        <span className="uppercase tracking-widest font-mono">or</span>
        <span className="h-px flex-1 max-w-[100px] bg-white/10" />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <GoogleConnect compact />
        <GoogleDrivePicker onFilesSelected={importFromDrive} disabled={disabled || importing}>
          <button
            type="button"
            disabled={disabled || importing}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            <svg width="13" height="13" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 5.1 29.4 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.2-.1-2.3-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 5.1 29.4 3 24 3 16.3 3 9.7 7.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.6 40.6 16.2 45 24 45z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.5 36.4 44 31 44 24c0-1.2-.1-2.3-.4-3.5z" />
            </svg>
            Import from Drive
          </button>
        </GoogleDrivePicker>
      </div>
    </div>
  );
}

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <span className="text-[10px] uppercase tracking-widest text-gray-600 font-mono">{label}</span>
        <span className="text-[10px] uppercase tracking-widest text-gray-600 font-mono">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#CCFF00] to-[#00D2FF] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DivisionCard({ div }: { div: DivSummary }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4 hover:border-white/20 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: div.color }} />
        <span className="text-[9px] font-mono tracking-widest text-gray-600 uppercase">DIV {div.code}</span>
      </div>
      <p className="text-xs font-bold text-white mt-1 leading-snug line-clamp-2">{div.trade}</p>
      <div className="mt-3 flex justify-between items-end">
        <div>
          <p className="text-2xl font-black text-white">{div.count}</p>
          <p className="text-gray-500 text-[10px]">line item{div.count !== 1 ? "s" : ""}</p>
        </div>
        <p className="text-[#CCFF00] text-[10px] font-mono">{formatQty(div.qty)} units</p>
      </div>
    </div>
  );
}

function TakeoffGrid({ rows }: { rows: TakeoffRow[] }) {
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("all");

  const divisions = Array.from(new Set(rows.map((r) => r.cost_code?.slice(0, 2) ?? "00"))).sort();

  const filtered = rows.filter((r) => {
    const matchDiv = divFilter === "all" || r.cost_code?.startsWith(divFilter);
    const q = search.toLowerCase();
    const matchSearch = !q
      || r.description?.toLowerCase().includes(q)
      || r.cost_code?.toLowerCase().includes(q)
      || r.trade?.toLowerCase().includes(q)
      || r.location_tag?.toLowerCase().includes(q);
    return matchDiv && matchSearch;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            aria-label="Search takeoff items"
            placeholder="Search items, codes, locations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-4 bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
          />
        </div>
        <select
          value={divFilter}
          onChange={(e) => setDivFilter(e.target.value)}
          aria-label="Filter by division"
          className="bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
        >
          <option value="all">All Divisions</option>
          {divisions.map((d) => <option key={d} value={d}>Division {d}</option>)}
        </select>
        <div className="ml-auto text-[10px] uppercase tracking-widest text-gray-600 font-mono">
          {filtered.length} items
        </div>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-[#0A0A0B]">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-medium w-28">Cost Code</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-medium">Description</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-medium">Location</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-medium">Qty</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-medium w-16">UOM</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest text-gray-600 font-medium w-20">Drawing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-600 text-xs uppercase tracking-widest">
                    No items match your filter. Try a different cost code or location.
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => (
                  <tr key={row.id ?? i} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: divColor(row.cost_code) }} />
                        <span className="text-[10px] font-mono text-gray-400">{row.cost_code}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-white">{row.description}</p>
                      <p className="text-gray-600 text-[10px] mt-0.5 truncate max-w-sm">{row.quantity_basis}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{row.location_tag || "-"}</td>
                    <td className="px-4 py-3 text-right font-mono text-[#CCFF00] font-bold text-xs">{formatQty(row.total_qty)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{row.uom}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{row.drawing_ref || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Saved item shape from DB
interface SavedItem {
  id: string;
  label: string | null;
  csi_code: string | null;
  division: string | null;
  quantity: number | null;
  unit: string | null;
  meta: Record<string, unknown> | null;
  review_status?: string | null;
  takeoff_job_id?: string | null;
  quantity_validation_status?: string | null;
  quantity_validation_reason?: string | null;
  is_stale?: boolean | null;
}

// Main component

export default function TakeoffTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [phase, setPhase]         = useState<Phase>("idle");
  const [rows, setRows]           = useState<TakeoffRow[]>([]);
  const [progress, setProgress]   = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);
  const [failedRows, setFailedRows]   = useState(0);
  const [fileName, setFileName]   = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [batchApproving, setBatchApproving] = useState(false);
  const handleScopeConfirmed = useCallback(() => setScopeConfirmed(true), []);
  const abortRef = useRef<AbortController | null>(null);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Multi-format (deterministic + AI) state ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [sourceType, setSourceType]   = useState<string | null>(null);
  const [coverage, setCoverage]       = useState<Coverage | null>(null);
  const [aiPages, setAiPages]         = useState<number[]>([]);
  const [aiPageRefs, setAiPageRefs]   = useState<AiPageRef[]>([]);
  const [aiRunning, setAiRunning]     = useState(false);
  const [hasLocalPdf, setHasLocalPdf] = useState(false);
  const pdfFileRef = useRef<File | null>(null);
  const activeDocumentIdRef = useRef<string | null>(null);
  const autoAiDocumentRef = useRef<string | null>(null);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Async page-split polling (large uploads routed off the sync stream) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [asyncPages, setAsyncPages] = useState<{ total: number; done: number; error: number }>({ total: 0, done: 0, error: 0 });
  const pollTimerRef = useRef<number | null>(null);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Saved items from DB ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedItem | null>(null);

  const loadSavedItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/takeoff/items?project_id=${encodeURIComponent(projectId)}&limit=500`);
      if (!res.ok) {
        setSavedItems([]);
        setLoadWarning(`Saved takeoff items could not be refreshed (${res.status}). The takeoff still works; try reloading in a moment.`);
        return false;
      }
      const d = (await res.json().catch(() => ({}))) as { items?: SavedItem[] };
      setSavedItems(d.items ?? []);
      setLoadWarning(null);
      return true;
    } catch {
      setSavedItems([]);
      setLoadWarning("Saved takeoff items could not be refreshed right now. The takeoff still works; try again in a moment.");
      return false;
    }
  }, [projectId]);

  const describeExtractionResult = useCallback((docName: string, extractedCount: number, candidatePages: number[]) => {
    if (extractedCount > 0) {
      return {
        auditStatus: "VERIFIED_SUCCESS",
        statusMsg: `Complete - ${extractedCount.toLocaleString()} line items from ${docName}`,
      };
    }
    if (candidatePages.length > 0) {
      return {
        auditStatus: "PARTIAL_WITH_ERRORS",
        statusMsg: `No line items were extracted from ${docName}. ${candidatePages.length} page${candidatePages.length === 1 ? "" : "s"} need AI vision review.`,
      };
    }
    return {
      auditStatus: "PARTIAL_WITH_ERRORS",
      statusMsg: `No line items were extracted from ${docName}. Review the document and retry from the project header or Drive button.`,
    };
  }, []);


  const deleteSavedItem = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/takeoff/items?id=${encodeURIComponent(id)}&project_id=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: String(typeof d?.error === "string" ? d.error : `Could not delete that takeoff item (${res.status})`), kind: "error" });
        return;
      }
      setSavedItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      toast({ title: String("Could not delete that takeoff item just now. Refresh the list and try again in a moment."), kind: "error" });
    } finally {
      setDeletingId(null);
    }
  }, [projectId, toast]);

  const decideSavedItem = useCallback(async (item: SavedItem, action: "approve" | "reject") => {
    setDecidingId(item.id);
    try {
      if (action === "reject") {
        const response = await fetch(`/api/takeoff/items/${encodeURIComponent(item.id)}/review`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Could not reject this candidate");
      } else {
        if (item.quantity_validation_status !== "validated" || !item.takeoff_job_id) {
          throw new Error(item.quantity_validation_reason?.replaceAll("_", " ") ?? "Validated source evidence is required");
        }
        const previewResponse = await fetch("/api/takeoff/approval-preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, jobId: item.takeoff_job_id, candidateIds: [item.id] }),
        });
        const previewBody = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !previewBody.preview?.id) throw new Error(previewBody.error ?? "Could not create approval preview");
        const previewId = previewBody.preview.id as string;
        const confirmation = await fetch(`/api/takeoff/approval-preview/${encodeURIComponent(previewId)}/confirm`, { method: "POST" });
        const confirmationBody = await confirmation.json().catch(() => ({}));
        if (!confirmation.ok) throw new Error(confirmationBody.error ?? "Could not confirm approval");
        const imported = await fetch("/api/estimate/import-takeoff", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, preview_id: previewId, idempotency_key: `takeoff-preview:${previewId}` }),
        });
        const importedBody = await imported.json().catch(() => ({}));
        if (!imported.ok) throw new Error(importedBody.error ?? "Could not import the approved quantity");
      }
      await loadSavedItems();
      toast({ title: action === "approve" ? "Quantity approved and imported to the draft estimate." : "Quantity rejected and excluded.", kind: "success" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : `Could not ${action} this quantity`, kind: "error" });
    } finally {
      setDecidingId(null);
    }
  }, [loadSavedItems, projectId, toast]);

  const acceptSavedRevision = useCallback(async (item: SavedItem) => {
    setDecidingId(item.id);
    try {
      const response = await fetch("/api/takeoff/source-revisions/approve", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: item.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not accept the source revision");
      toast({ title: "Revision accepted. Run extraction again to validate quantities against it.", kind: "success" });
      await loadSavedItems();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Could not accept the source revision", kind: "error" });
    } finally {
      setDecidingId(null);
    }
  }, [loadSavedItems, toast]);

  const approveAndImportReady = useCallback(async () => {
    const ready = savedItems.filter((item) =>
      (item.review_status === "suggested" || item.review_status === "reviewed")
      && item.quantity_validation_status === "validated" && item.takeoff_job_id && !item.is_stale,
    );
    const pending = savedItems.filter((item) => item.review_status === "suggested" || item.review_status === "reviewed");
    if (ready.length === 0 || ready.length !== pending.length) return;
    setBatchApproving(true);
    try {
      const byJob = new Map<string, string[]>();
      for (const item of ready) byJob.set(item.takeoff_job_id!, [...(byJob.get(item.takeoff_job_id!) ?? []), item.id]);
      for (const [jobId, candidateIds] of byJob) {
        const previewResponse = await fetch("/api/takeoff/approval-preview", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, jobId, candidateIds }),
        });
        const previewBody = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok || !previewBody.preview?.id) throw new Error(previewBody.error ?? "Could not create approval preview");
        const previewId = previewBody.preview.id as string;
        const confirmation = await fetch(`/api/takeoff/approval-preview/${encodeURIComponent(previewId)}/confirm`, { method: "POST" });
        const confirmationBody = await confirmation.json().catch(() => ({}));
        if (!confirmation.ok) throw new Error(confirmationBody.error ?? "Could not confirm approval");
        const imported = await fetch("/api/estimate/import-takeoff", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, preview_id: previewId, idempotency_key: `takeoff-preview:${previewId}` }),
        });
        const importedBody = await imported.json().catch(() => ({}));
        if (!imported.ok) throw new Error(importedBody.error ?? "Could not import approved quantities");
      }
      await loadSavedItems();
      toast({ title: `${ready.length} ${ready.length === 1 ? "quantity" : "quantities"} approved and imported to the draft estimate.`, kind: "success" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Could not approve and import these quantities", kind: "error" });
    } finally {
      setBatchApproving(false);
    }
  }, [loadSavedItems, projectId, savedItems, toast]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ "Run takeoff from an uploaded document" ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [docs, setDocs] = useState<{ id: string; file_name: string; drive: boolean }[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string>("");

  useEffect(() => {
    // Fix: abort any in-flight upload/stream when projectId changes or component unmounts
    // (previously the stream readers would keep writing into stale state).
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSavedItems();
    }, 0);
    fetch(`/api/documents?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: { documents?: Array<{ id: string; file_name: string; meta?: Record<string, unknown> | null }> }) => {
        if (cancelled) return;
        const pdfs = (d.documents ?? []).filter((x) => {
          const m = (x.meta as Record<string, unknown> | null) ?? {};
          return x.file_name?.toLowerCase().endsWith(".pdf") && (m.storage_path || m.drive_file_id);
        });
        setDocs(pdfs.map((x) => ({
          id: x.id, file_name: x.file_name,
          drive: !!(x.meta as Record<string, unknown> | null)?.drive_file_id,
        })));
      })
      .catch(() => { if (!cancelled) setDocs([]); });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      abortRef.current?.abort();
      if (pollTimerRef.current != null) window.clearTimeout(pollTimerRef.current);
    };
  }, [projectId, loadSavedItems, toast]);

  const persistRows = useCallback(async (rowsToSave: TakeoffRow[]) => {
    if (rowsToSave.length === 0) return;
    setSaveStatus("saving");
    const payload = rowsToSave.map((r) => ({
      label: r.description,
      csi_code: r.cost_code,
      division: r.cost_code?.slice(0, 2),
      quantity: r.total_qty,
      unit: r.uom,
      rate: 0,
      type: "takeoff_import",
      page: r.page ?? 0,
      document_id: r.document_id ?? null,
      meta: {
        trade: r.trade,
        quantity_basis: r.quantity_basis,
        drawing_ref: r.drawing_ref,
        location_tag: r.location_tag,
        quantity_evidence: r.quantity_evidence ?? null,
        extraction_method: r.extraction_method ?? (r.id?.startsWith("ai-") ? "ai_vision" : "deterministic"),
      },
    }));
    try {
      const res = await fetch(`/api/takeoff/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, rows: payload }),
      });
      if (res.ok) {
        const refreshed = await loadSavedItems();
        setSaveStatus(refreshed ? "saved" : "error");
        toast({ title: `Saved ${rowsToSave.length} takeoff item${rowsToSave.length === 1 ? "" : "s"}.`, kind: "success" });
      } else {
        setSaveStatus("error");
        const d = await res.json().catch(() => ({}));
        toast({
          title: typeof d?.error === "string" ? `Could not save these takeoff items: ${d.error}` : `Could not save these takeoff items (${res.status})`,
          kind: "error",
        });
      }
    } catch {
      setSaveStatus("error");
      toast({ title: "Takeoff items were not saved. Try again in a moment.", kind: "error" });
    }
  }, [projectId, loadSavedItems, toast]);

  // Shared NDJSON page-by-page reader for the *synchronous* from-document
  // path (small/local-disk/Drive files that didn't get routed async).
  // Previously extractDeterministic's storage-upload branch called
  // `res.json()` on this same NDJSON body, which silently failed to parse
  // (multiple newline-delimited JSON objects aren't valid single JSON) and
  // always produced zero rows - fixed by reading it the same way
  // runFromDocument already does.
  const consumeNdjsonExtractStream = useCallback(async (body: ReadableStream<Uint8Array>, docName: string, documentId?: string) => {
    setPhase("streaming"); setStatusMsg("Extracting...");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let collected: TakeoffRow[] = [];

    const handle = (ev: { event: string; page?: number; total_pages?: number; rows?: TakeoffRow[]; total_rows?: number; ai_candidate_pages?: number[]; message?: string; source_type?: string; coverage?: Coverage }) => {
      switch (ev.event) {
        case "STARTED":
          setTotalRows(0);
          setStatusMsg(`Reading ${ev.total_pages ?? 0} pages from ${docName}...`);
          break;
        case "PAGE": {
          const newRows = (ev.rows ?? []).map((r, i) => ({ ...r, id: `doc-${ev.page}-${i}`, page: ev.page ?? null, document_id: documentId ?? null }));
          if (newRows.length) { collected = [...collected, ...newRows]; setRows(collected); }
          const total = ev.total_pages || 1;
          setProgress(Math.round(((ev.page ?? 0) / total) * 100));
          setStatusMsg(`Page ${ev.page} of ${total} - ${collected.length} item${collected.length !== 1 ? "s" : ""} so far`);
          break;
        }
        case "COMPLETED":
          setAiPages(ev.ai_candidate_pages ?? []);
          setProgress(100);
          {
            const outcome = describeExtractionResult(docName, collected.length, ev.ai_candidate_pages ?? []);
            setAuditStatus(outcome.auditStatus);
            setStatusMsg(outcome.statusMsg);
          }
          setPhase("done");
          void persistRows(collected);
          break;
        case "ERROR":
          setPhase("error"); setStatusMsg(ev.message ?? "Could not finish reading that file just now. Try it again from the project header or Drive button."); break;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (abortRef.current?.signal.aborted) break;
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) { const t = line.trim(); if (t) try { handle(JSON.parse(t)); } catch { /* skip */ } }
      }
      if (buf.trim()) try { handle(JSON.parse(buf.trim())); } catch { /* skip */ }
    } catch {
      setPhase("error"); setStatusMsg("Could not finish reading that file just now. Please try again from the project header or Drive button.");
    }
  }, [describeExtractionResult, persistRows]);

  const reset = () => {
    abortRef.current?.abort();
    if (pollTimerRef.current != null) { window.clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    setPhase("idle"); setRows([]); setProgress(0); setStatusMsg("");
    setTotalRows(0); setAuditStatus(null); setFailedRows(0); setFileName("");
    setSourceType("pdf · page-by-page"); setCoverage(null); setAiPages([]); setAiPageRefs([]);
    setAiPageRefs([]);
    setHasLocalPdf(false); setAsyncPages({ total: 0, done: 0, error: 0 });
    pdfFileRef.current = null;
    activeDocumentIdRef.current = null;
    autoAiDocumentRef.current = null;
  };

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Poll the async page-split pipeline for large uploads ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  // (page-split-worker ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ page-processor + page-takeoff-worker fan-out per
  // page). Replaces the synchronous NDJSON reader loop once a from-document
  // call comes back `{ status: "processing", async: true }`.
  const pollSplitStatus = useCallback((documentId: string, docName: string) => {
    setPhase("processing_async");
    setStatusMsg(`Started background processing - ${docName}`);
    setProgress(0);
    const pollStartedAt = Date.now();
    const POLL_TIMEOUT_MS = 20 * 60 * 1000;

    const tick = async () => {
      if (abortRef.current?.signal.aborted) return;
      if (Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
        setPhase("error");
        setStatusMsg(`Processing ${docName} exceeded 20 minutes. The attempt was stopped and can be retried safely.`);
        return;
      }
      try {
        const res = await fetch(`/api/takeoff/split-status?document_id=${encodeURIComponent(documentId)}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({})) as {
          pages_total?: number; pages_done?: number; pages_error?: number;
          finished?: boolean; document_status?: string; items?: SavedTakeoffItem[]; error?: string | null;
          ai_candidate_pages?: number[];
          ai_page_refs?: AiPageRef[];
        };
        if (!res.ok) {
          setPhase("error");
          setStatusMsg(data.error || `Background processing could not be checked (${res.status}). The uploaded file is still saved; retry extraction from this project.`);
          return;
        }
        const total = data.pages_total ?? 0;
        const done = data.pages_done ?? 0;
        const errorCount = data.pages_error ?? 0;
        setAsyncPages({ total, done, error: errorCount });

        if (total > 0) {
          setProgress(Math.round(((done + errorCount) / total) * 100));
          setStatusMsg(`Page ${done + errorCount} of ${total} processed${errorCount > 0 ? ` (${errorCount} failed)` : ""}...`);
        } else {
          setStatusMsg(`Splitting ${docName} into pages...`);
        }

        if (data.finished) {
          const items = data.items ?? [];
          const extracted: TakeoffRow[] = items.map((it, i) => {
            const meta = it.meta ?? {};
            return {
              id: it.id ?? `async-${i}`,
              trade: String(meta.trade ?? ""),
              cost_code: it.csi_code ?? "",
              description: it.label ?? "",
              quantity_basis: String(meta.quantity_basis ?? ""),
              total_qty: Number(it.quantity ?? 0),
              uom: it.unit ?? "",
              drawing_ref: (meta.drawing_ref as string | null) ?? null,
              location_tag: (meta.location_tag as string | null) ?? null,
              extraction_method: (meta.extraction_method as "deterministic" | "ai_vision") ?? "deterministic",
            };
          });
          const aiCandidatePages = Array.isArray(data.ai_candidate_pages)
            ? data.ai_candidate_pages.filter((page): page is number => typeof page === "number" && Number.isFinite(page))
            : [];
          const pageRefs = Array.isArray(data.ai_page_refs)
            ? data.ai_page_refs
                .filter((page): page is AiPageRef => !!page && typeof page.page_number === "number" && typeof page.page_id === "string")
                .map((page) => ({ page_number: page.page_number, page_id: page.page_id }))
            : [];
          setRows(extracted);
          setTotalRows(extracted.length);
          setProgress(100);
          setAiPages(aiCandidatePages);
          setAiPageRefs(pageRefs);
          const outcome = describeExtractionResult(docName, extracted.length, aiCandidatePages);
          setAuditStatus(outcome.auditStatus);
          setStatusMsg(
            data.document_status === "error"
              ? `Background processing failed for ${docName}. Open the document list, then retry from the project header or Drive button.`
              : outcome.statusMsg,
          );
          setPhase(data.document_status === "error" && extracted.length === 0 ? "error" : "done");
          if (extracted.length === 0 && aiCandidatePages.length > 0 && documentId !== autoAiDocumentRef.current) {
            autoAiDocumentRef.current = documentId;
          }
          // Rows are already persisted by page-takeoff-worker directly -
          // just refresh the saved-items list, don't re-POST them.
          setSaveStatus("saved");
          loadSavedItems();
          toast({
            title: `Finished processing ${docName}.`,
            description: extracted.length > 0
              ? `Loaded ${extracted.length} takeoff item${extracted.length === 1 ? "" : "s"} into the list.`
              : aiCandidatePages.length > 0
                ? `${aiCandidatePages.length} page${aiCandidatePages.length === 1 ? "" : "s"} need AI vision review before this takeoff is usable.`
                : "The document finished, but no line items were found.",
            kind: extracted.length > 0 ? "success" : "warning",
          });
          return;
        }
        if (data.document_status === "error") {
          setPhase("error");
          setStatusMsg(data.error || `Background processing failed for ${docName}. Retry the upload.`);
          return;
        }
      } catch {
        // transient network hiccup - keep polling rather than failing the whole run
      }
      pollTimerRef.current = window.setTimeout(tick, 2500);
    };
    void tick();
  }, [describeExtractionResult, loadSavedItems, toast]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Deterministic extraction (PDF tables / DXF / IFC / XLSX) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  //
  // Every source file is stored before extraction. Besides avoiding request
  // size limits, this is required for reproducible page checksums, revision
  // lineage, and approval evidence.
  const extractDeterministic = useCallback(async (file: File) => {
    setFileName(file.name); setPhase("uploading"); setRows([]);
    setProgress(0); setStatusMsg("Extracting..."); setAuditStatus(null);
    setSourceType("pdf · page-by-page"); setCoverage(null); setAiPages([]); setAiPageRefs([]);
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    pdfFileRef.current = isPdf ? file : null;
    setHasLocalPdf(isPdf);
    setAiPageRefs([]);
    activeDocumentIdRef.current = null;
    autoAiDocumentRef.current = null;

    const useStorageUpload = true;

    let res: Response;
    try {
      if (useStorageUpload) {
        // Prefer direct Supabase Storage upload - no Google OAuth consent
        // required, and now that the project is on the Pro plan (5GB global
        // Storage ceiling, plans-bucket raised to 1GB) it comfortably covers
        // real construction plan sets. Previously Drive was tried first to
        // route around the Free tier's 50MB global ceiling; that constraint
        // is gone. Falls back to Google Drive only if the Supabase upload
        // itself fails (e.g. a single file over the 1GB bucket limit).
        setStatusMsg("Starting upload...");
        const urlRes = await fetchWithRetry("/api/takeoff/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            file_name: file.name,
            size: file.size,
            content_type: file.type || "application/octet-stream",
          }),
        }, { retries: 1 });
        const urlData = await urlRes.json().catch(() => ({}));

        let documentId: string;
        if (urlRes.ok && urlData?.upload?.url) {
          const reservedDocumentId = String(urlData.document_id ?? "");
          setStatusMsg("Uploading to secure storage...");
          let putRes: Response;
          try {
            putRes = await fetch(urlData.upload.url, {
              method: "PUT",
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "x-upsert": "false",
              },
              body: file,
            });
          } catch (uploadError) {
            if (reservedDocumentId) {
              void fetch("/api/takeoff/upload-url", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ document_id: reservedDocumentId }),
              });
            }
            throw uploadError;
          }
          if (!putRes.ok) {
            const detail = await putRes.text().catch(() => putRes.statusText);
            if (reservedDocumentId) {
              await fetch("/api/takeoff/upload-url", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ document_id: reservedDocumentId }),
              }).catch(() => {});
            }
            setPhase("error");
            setStatusMsg(`Storage upload failed (${putRes.status}): ${detail.slice(0, 200)}`);
            return;
          }
          documentId = reservedDocumentId;
        } else {
          // Fallback: Google Drive (handles files larger than the Supabase
          // bucket limit, or covers a transient Storage error).
          setStatusMsg("Starting Drive upload...");
          const driveSessionRes = await fetchWithRetry("/api/takeoff/drive-upload-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_id: projectId,
              file_name: file.name,
              size: file.size,
              content_type: file.type || "application/octet-stream",
            }),
          }, { retries: 1 });
          const driveSessionData = await driveSessionRes.json().catch(() => ({}));
          if (!driveSessionRes.ok || !driveSessionData?.upload?.url) {
            setPhase("error");
            setStatusMsg(
              typeof urlData?.error === "string" ? urlData.error
                : typeof driveSessionData?.error === "string" ? driveSessionData.error
                : `Upload failed (${urlRes.status})`,
            );
            return;
          }
          setStatusMsg("Uploading to Google Drive...");
          const putRes = await fetch(driveSessionData.upload.url, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!putRes.ok) {
            const detail = await putRes.text().catch(() => putRes.statusText);
            setPhase("error");
            setStatusMsg(`Drive upload failed (${putRes.status}): ${detail.slice(0, 200)}`);
            return;
          }
          const driveFile = await putRes.json().catch(() => ({})) as { id?: string };
          if (!driveFile.id) {
            setPhase("error"); setStatusMsg("Drive did not finish confirming the upload. Please retry from the project header or Drive button."); return;
          }
          const finalizeRes = await fetch("/api/takeoff/drive-upload-session/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ document_id: driveSessionData.document_id, drive_file_id: driveFile.id }),
          });
          if (!finalizeRes.ok) {
            setPhase("error"); setStatusMsg("Drive upload started, but we could not finish it. Please retry from the project header or Drive button."); return;
          }
          documentId = driveSessionData.document_id;
        }

        // Run takeoff off the uploaded file - large PDFs may come back as an
        // async 202 (started in the background page-split pipeline) instead
        // of the usual synchronous NDJSON stream.
        setStatusMsg("Extracting...");
        res = await fetchWithRetry(`/api/takeoff/from-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            document_id: documentId,
            project_id: projectId,
          }),
        }, { retries: 1 });

        if (res.status === 202) {
          const asyncData = await res.json().catch(() => ({})) as { document_id?: string; async?: boolean };
          if (asyncData.async && asyncData.document_id) {
            activeDocumentIdRef.current = asyncData.document_id;
            pollSplitStatus(asyncData.document_id, file.name);
            return;
          }
        }
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}));
          setPhase("error"); setStatusMsg(typeof d?.error === "string" ? d.error : `Could not extract from that file (${res.status}). Try again from the project header or Drive button.`); return;
        }
        await consumeNdjsonExtractStream(res.body, file.name, documentId);
        return;
      } else {
        // Small file: direct multipart to Vercel is fine.
        const form = new FormData();
        form.append("file", file);
        res = await fetchWithRetry(`/api/takeoff/extract?project_id=${encodeURIComponent(projectId)}`, {
          method: "POST", body: form,
        }, { retries: 1 });
      }
    } catch {
      setPhase("error"); setStatusMsg("Could not upload that file just now. Check your connection, then try again from the project header or Drive button."); return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPhase("error");
      setStatusMsg(typeof data?.error === "string" ? data.error : `Could not extract from that file (${res.status}). Try again from the project header or Drive button.`);
      return;
    }

    const extracted: TakeoffRow[] = (data.rows ?? []).map((r: TakeoffRow, i: number) => ({
      ...r, id: r.id ?? `det-${i}`,
    }));

    setSourceType("pdf · page-by-page"); setCoverage(null); setAiPages([]); setAiPageRefs([]);
    setCoverage(data.coverage ?? null);
    setAiPages(Array.isArray(data.ai_candidate_pages) ? data.ai_candidate_pages : []);
    setAiPageRefs([]);
    setRows(extracted);
    setProgress(100);
    setTotalRows(extracted.length);
    {
      const outcome = describeExtractionResult(file.name, extracted.length, Array.isArray(data.ai_candidate_pages) ? data.ai_candidate_pages : []);
      setAuditStatus(outcome.auditStatus);
      setStatusMsg(outcome.statusMsg);
    }
    setPhase("done");
    await persistRows(extracted);
  }, [describeExtractionResult, persistRows, projectId, pollSplitStatus, consumeNdjsonExtractStream]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Page-by-page takeoff from an already-uploaded document (memory-safe) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const runFromDocument = useCallback(async (documentId: string, docName: string, isDrive = false) => {
    pdfFileRef.current = null; // document flow has no local File
    setHasLocalPdf(false);
    activeDocumentIdRef.current = documentId;
    autoAiDocumentRef.current = null;
    setFileName(docName); setPhase("streaming"); setRows([]);
    setProgress(0); setAuditStatus(null); setFailedRows(0);
    setSourceType("pdf · page-by-page"); setCoverage(null); setAiPages([]); setAiPageRefs([]);
    setStatusMsg("Loading document...");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isDrive) {
      const gToken = await getGoogleToken().catch(() => null);
      if (!gToken) { setPhase("error"); setStatusMsg("This plan lives in Google Drive. Connect Google from the project header or Drive button, then try again."); return; }
      headers["X-Google-Token"] = gToken;
    }

    let res: Response;
    try {
      res = await fetch(`/api/takeoff/from-document`, {
        method: "POST",
        headers,
        body: JSON.stringify({ document_id: documentId, project_id: projectId }),
      });
    } catch {
      setPhase("error"); setStatusMsg("Could not reach the server just now. Please try again in a moment."); return;
    }
    if (res.status === 202) {
      const asyncData = await res.json().catch(() => ({})) as { document_id?: string; async?: boolean };
      if (asyncData.async && asyncData.document_id) {
        activeDocumentIdRef.current = asyncData.document_id;
        pollSplitStatus(asyncData.document_id, docName);
        return;
      }
    }
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      setPhase("error"); setStatusMsg(typeof d?.error === "string" ? d.error : `Failed (${res.status})`); return;
    }

    await consumeNdjsonExtractStream(res.body, docName, documentId);
  }, [projectId, pollSplitStatus, consumeNdjsonExtractStream]);

  // AI vision fallback (Sonnet) for graphical PDF pages
  const runAiFallback = useCallback(async () => {
    const file = pdfFileRef.current;
    if ((!file && aiPageRefs.length === 0) || aiRunning) return;
    setAiRunning(true);
    setStatusMsg("Running AI vision on graphical pages...");

    try {
      let aiRows: TakeoffRow[] = [];
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const qs = aiPages.length ? `?pages=${encodeURIComponent(aiPages.join(","))}` : "";
        const aiQs = qs ? `${qs}&ai_fallback=true` : `?ai_fallback=true`;
        const res = await fetchWithRetry(`/api/takeoff/extract${aiQs}`, { method: "POST", body: form }, { retries: 1 });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatusMsg(typeof data?.error === "string" ? data.error : `Could not run AI extraction (${res.status}). Try the file again from the project header or Drive import.`);
          setAiRunning(false);
          return;
        }
        aiRows = (data.rows ?? []).map((r: TakeoffRow, i: number) => ({
          ...r, id: `ai-${i}`, extraction_method: "ai_vision",
        }));
      } else {
        const pagesToRun = aiPageRefs.filter((page) => aiPages.includes(page.page_number));
        if (pagesToRun.length === 0) {
          setStatusMsg("No stored drawing pages are ready for AI review yet. Reopen the document list and retry.");
          setAiRunning(false);
          return;
        }
        const aiRowsCollected: TakeoffRow[] = [];
        for (const page of pagesToRun) {
            const res = await fetchWithRetry("/api/takeoff/canvas/vision-extract", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ page_id: page.page_id }),
            }, { retries: 1 });
            const data = await res.json().catch(() => ({})) as { result?: { items?: Array<Record<string, unknown>> }; error?: string };
            if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : `Could not run AI extraction for page ${page.page_number}`);
            const items = Array.isArray(data.result?.items) ? data.result.items : [];
            aiRowsCollected.push(...items.map((item, index) => ({
              id: `ai-${page.page_number}-${index}`,
              trade: "AI Vision",
              cost_code: typeof item.cost_code === "string" && item.cost_code.length > 0 ? item.cost_code : "01-00-00",
              description: typeof item.description === "string" ? item.description : `AI vision item - page ${page.page_number}`,
              quantity_basis: typeof item.raw_text === "string" && item.raw_text.trim().length > 0 ? item.raw_text : "AI vision extraction",
              total_qty: typeof item.quantity === "number" ? item.quantity : Number(item.quantity ?? 0),
              uom: typeof item.unit === "string" && item.unit.length > 0 ? item.unit : "EA",
              drawing_ref: fileName || null,
              location_tag: `Page ${page.page_number}`,
              extraction_method: "ai_vision" as const,
              page: page.page_number,
              document_id: activeDocumentIdRef.current,
            } satisfies TakeoffRow)));
          }
        aiRows = aiRowsCollected;
      }
      setRows((prev) => [...prev, ...aiRows]);
      setAiPages([]); // consumed
      setAiPageRefs([]);
      setStatusMsg(`AI added ${aiRows.length.toLocaleString()} line items from graphical pages`);
      await persistRows([...rows, ...aiRows]);
    } catch {
      setStatusMsg("Could not run AI extraction just now. Try the page again from the project header or Drive import.");
    } finally {
      setAiRunning(false);
    }
  }, [aiPageRefs, aiPages, aiRunning, fileName, persistRows, rows]);

  useEffect(() => {
    if (phase !== "done") return;
    const documentId = activeDocumentIdRef.current;
    if (!documentId) return;
    if (aiRunning) return;
    if (rows.length > 0) return;
    if (aiPages.length === 0 || aiPageRefs.length === 0) return;
    if (autoAiDocumentRef.current !== documentId) return;
    autoAiDocumentRef.current = `${documentId}:started`;
    void runAiFallback();
  }, [aiPageRefs, aiPages, aiRunning, phase, rows.length, runAiFallback]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".json")) {
      await extractDeterministic(file);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pdfFileRef.current = null;
    setHasLocalPdf(false);

    setFileName(file.name); setPhase("uploading"); setRows([]);
    setProgress(0); setStatusMsg("Uploading..."); setAuditStatus(null); setFailedRows(0);

    const form = new FormData();
    form.append("file", file);

    let res: Response;
    try {
      res = await fetch(`/api/takeoff/extract?project_id=${encodeURIComponent(projectId)}&stream=true`, {
        method: "POST", body: form, signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setPhase("error"); setStatusMsg("Could not upload that file just now. Check your connection, then try again from the project header or Drive button."); return;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "unknown error");
      setPhase("error"); setStatusMsg(`Upload failed (${res.status}): ${txt}`); return;
    }

    setPhase("streaming"); setStatusMsg("Validating takeoff data...");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const jsonRows: TakeoffRow[] = [];

    const process = (ev: StreamEvent) => {
      switch (ev.event) {
        case "PARSING_STARTED":
          setTotalRows(ev.total_rows);
          setStatusMsg(`Parsing ${ev.total_rows.toLocaleString()} rows from ${ev.file}...`);
          break;
        case "CHUNK_PROCESSED":
          jsonRows.push(...ev.rows);
          setRows((prev) => [...prev, ...ev.rows]);
          setProgress(ev.progress_pct);
          setStatusMsg(`Validated ${ev.processed_count.toLocaleString()} of ${ev.total_rows.toLocaleString()} rows...`);
          break;
        case "PARSING_COMPLETED":
          setProgress(100); setAuditStatus(ev.audit_status);
          setFailedRows(ev.failed_rows);
          setStatusMsg(`Complete - ${ev.final_row_count.toLocaleString()} rows validated`);
          setPhase("done");
          void persistRows(jsonRows);
          break;
        case "ROW_VALIDATION_ERROR":
          setFailedRows(ev.error_count ?? 0); break;
        case "CRITICAL_PARSER_FAILURE":
          setPhase("error"); setStatusMsg(`We could not read this file cleanly: ${ev.message ?? "unknown error"}. Try the file again or use a different export.`); break;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        // Estimator may have switched projects mid-stream - stop before this
        // stale reader writes another page's rows into the new project's state.
        if (abortRef.current?.signal.aborted) break;
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) { const t = line.trim(); if (t) try { process(JSON.parse(t)); } catch { /* skip */ } }
      }
      if (buf.trim()) try { process(JSON.parse(buf.trim())); } catch { /* skip */ }
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setPhase("error"); setStatusMsg("Could not finish reading that file just now. Please try the file again."); }
    }
  }, [persistRows, projectId, extractDeterministic]);

  const divisions = buildDivisions(rows);

  // Idle
  if (phase === "idle") {
    return (
      <div className="max-w-2xl mx-auto py-4">
        <div className="mb-6">
          <h2 className="text-xs font-bold text-white uppercase tracking-widest">Takeoff</h2>
          <p className="text-[11px] text-gray-600 mt-1">
            Upload a plan, model, or schedule. The app will pull out quantities automatically and keep the CSI coding attached.
          </p>
        </div>
        <ScopePreflight projectId={projectId} onConfirmed={handleScopeConfirmed} />
        <AutomatedTakeoffStatus projectId={projectId} />
        <AutomatedTakeoffReview candidates={savedItems} working={batchApproving} onApproveAndImport={() => void approveAndImportReady()} />
        <UploadZone onFile={handleFile} disabled={!scopeConfirmed} />
        {!scopeConfirmed && <p className="mt-2 text-center text-[10px] uppercase tracking-widest text-white/30">Confirm the processing scope to enable automated extraction</p>}

        {docs.length > 0 && (
          <div className="mt-6 rounded-xl border border-white/10 bg-[#0E0F12] p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF]" />
              <span className="text-[11px] uppercase tracking-widest text-gray-400">Or use an uploaded plan</span>
            </div>
            <p className="text-[11px] text-gray-600 mb-3">
              Best for large plans. The file is read <span className="text-gray-400">one page at a time</span> so big drawing sets keep moving.
            </p>
            <div className="flex items-center gap-2">
              <select
                value={selectedDoc}
                onChange={(e) => setSelectedDoc(e.target.value)}
                className="flex-1 bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
              >
                <option value="">Select a plan...</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.file_name}{d.drive ? "  (Drive)" : ""}</option>)}
              </select>
              <button
                onClick={() => { const d = docs.find((x) => x.id === selectedDoc); if (d) runFromDocument(d.id, d.file_name, d.drive); }}
                disabled={!selectedDoc || !scopeConfirmed}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-30"
              >
                Start extraction
              </button>
            </div>
          </div>
        )}

        {savedItems.length > 0 && (
          <div className="mt-6 rounded-xl border border-white/10 bg-[#0E0F12] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#CCFF00]" />
                <span className="text-[11px] uppercase tracking-widest text-gray-400">Saved items</span>
                <span className="text-[10px] text-gray-600 font-mono">({savedItems.length})</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-4 py-2 text-gray-600 uppercase tracking-widest font-normal">Item</th>
                    <th className="text-left px-4 py-2 text-gray-600 uppercase tracking-widest font-normal">Code</th>
                    <th className="text-right px-4 py-2 text-gray-600 uppercase tracking-widest font-normal">Qty</th>
                    <th className="text-left px-4 py-2 text-gray-600 uppercase tracking-widest font-normal">Unit</th>
                    <th className="text-left px-4 py-2 text-gray-600 uppercase tracking-widest font-normal">Evidence</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {savedItems.map((item) => (
                    <tr key={item.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2 text-white/80 max-w-[260px] truncate">{item.label ?? "-"}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono">{item.csi_code ?? "-"}</td>
                      <td className="px-4 py-2 text-right text-gray-400 font-mono">{item.quantity != null ? item.quantity.toLocaleString() : "-"}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono uppercase">{item.unit ?? "-"}</td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          item.review_status === "approved" ? "bg-[#CCFF00]/15 text-[#CCFF00]" :
                          item.review_status === "rejected" ? "bg-red-400/15 text-red-300" :
                          item.quantity_validation_status === "validated" ? "bg-cyan-400/15 text-cyan-300" : "bg-amber-400/15 text-amber-300"
                        }`}>
                          {item.review_status === "approved" || item.review_status === "rejected"
                            ? item.review_status
                            : item.quantity_validation_status === "validated" ? "ready for review" : item.quantity_validation_reason?.replaceAll("_", " ") ?? "evidence required"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {(item.review_status === "suggested" || item.review_status === "reviewed") && (
                          <span className="mr-3 inline-flex items-center gap-1.5">
                            {item.quantity_validation_reason === "stale_revision" && (
                              <button type="button" disabled={decidingId === item.id} onClick={() => void acceptSavedRevision(item)} className="text-[9px] font-bold uppercase tracking-wider text-amber-300 hover:text-amber-100 disabled:opacity-40">Accept revision</button>
                            )}
                            <button type="button" disabled={decidingId === item.id} onClick={() => void decideSavedItem(item, "reject")} className="text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-red-300 disabled:opacity-40">Reject</button>
                            <button type="button" disabled={decidingId === item.id || item.quantity_validation_status !== "validated" || !item.takeoff_job_id} onClick={() => void decideSavedItem(item, "approve")} className="rounded-full bg-[#CCFF00] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-black disabled:opacity-30">Approve</button>
                          </span>
                        )}
                        <button
                          onClick={() => setDeleteTarget(item)}
                          disabled={deletingId === item.id}
                          aria-label="Delete saved item"
                          className="min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors disabled:opacity-30"
                          title="Delete item"
                        >
                          {deletingId === item.id ? (
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Error
  if (phase === "error") {
    return (
      <div className="max-w-2xl mx-auto py-4">
        <div className="rounded-xl border border-[#E50914]/20 bg-[#E50914]/[0.05] p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-[#E50914]/10 border border-[#E50914]/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-[#E50914]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-[#E50914] text-xs font-mono uppercase tracking-widest">{statusMsg}</p>
          <button
            onClick={reset}
            className="mt-4 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Large upload routed to the async page-split pipeline - polling document_pages
  if (phase === "processing_async") {
    return (
      <div className="max-w-2xl mx-auto py-4">
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-8">
          <div className="flex items-center gap-3 mb-6">
            <svg className="w-4 h-4 text-[#00D2FF] animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <div>
              <p className="text-white text-xs font-bold tracking-wide">{fileName}</p>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest font-mono mt-0.5">{statusMsg}</p>
            </div>
          </div>
          <ProgressBar
            pct={progress}
            label={asyncPages.total > 0 ? `Page ${asyncPages.done + asyncPages.error} of ${asyncPages.total} processed` : "Splitting document..."}
          />
          <p className="mt-4 text-[11px] text-gray-600 text-center">
            Large plan set - processing in the background across multiple pages at once.
            This tab will update automatically; you can navigate away and come back.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white"
            >
              Back to takeoff
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Uploading or streaming with no rows yet
  if (phase === "uploading" || (phase === "streaming" && rows.length === 0)) {
    return (
      <div className="max-w-2xl mx-auto py-4">
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-8">
          <div className="flex items-center gap-3 mb-6">
            <svg className="w-4 h-4 text-[#CCFF00] animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <div>
              <p className="text-white text-xs font-bold tracking-wide">{fileName}</p>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest font-mono mt-0.5">{statusMsg}</p>
            </div>
          </div>
          <ProgressBar pct={progress} label={phase === "uploading" ? "Uploading file..." : "Reading pages..."} />
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Streaming with rows coming in, or done
  return (
      <div className="space-y-6">
      {loadWarning && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          <div className="font-semibold">Takeoff data refresh had trouble.</div>
          <div className="mt-1 text-amber-100/80">{loadWarning}</div>
          <button
            type="button"
            onClick={() => void loadSavedItems()}
            className="mt-3 inline-flex h-9 items-center rounded-full border border-amber-300/30 bg-amber-300/10 px-3 text-[11px] font-semibold uppercase tracking-widest text-amber-100 hover:bg-amber-300/20"
          >
            Refresh saved items
          </button>
        </div>
      )}
      {/* Status bar */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            {phase === "streaming" ? (
              <svg className="w-4 h-4 text-[#CCFF00] animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <div className="w-4 h-4 rounded-full bg-[#CCFF00]/20 border border-[#CCFF00]/30 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-[#CCFF00]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
            <span className="text-xs text-gray-400">{statusMsg}</span>
          </div>
          <div className="flex items-center gap-3">
            {phase === "done" && auditStatus && (
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-widest
                ${auditStatus === "VERIFIED_SUCCESS" ? "bg-[#CCFF00]/10 text-[#CCFF00] border border-[#CCFF00]/20" :
                  auditStatus === "PARTIAL_WITH_ERRORS" ? "bg-yellow-900/20 text-yellow-400 border border-yellow-900/40" :
                  "bg-[#E50914]/10 text-[#E50914] border border-[#E50914]/20"}`}>
                {auditStatus.replace(/_/g, " ")}
              </span>
            )}
            {phase === "done" && saveStatus === "saving" && (
              <span className="text-[10px] text-[#00D2FF] uppercase tracking-widest font-mono">Saving...</span>
            )}
            {phase === "done" && saveStatus === "saved" && (
              <span className="text-[10px] text-[#CCFF00] uppercase tracking-widest font-mono">Saved to project</span>
            )}
            {phase === "done" && saveStatus === "error" && (
              <span className="text-[10px] text-[#E50914] uppercase tracking-widest font-mono">Save incomplete</span>
            )}
      {phase === "done" && (
        <button
          onClick={reset}
          className="text-[10px] text-gray-600 hover:text-gray-400 uppercase tracking-widest font-mono transition-colors"
        >
          Start another takeoff
        </button>
            )}
          </div>
        </div>
        {phase === "streaming" && (
          <ProgressBar pct={progress} label={`${rows.length.toLocaleString()} of ${totalRows.toLocaleString()} rows`} />
        )}
      </div>

      {/* Source + coverage chip (deterministic extractions) */}
      {sourceType && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
                    <span className="px-2 py-0.5 rounded bg-[#00D2FF]/10 text-[#00D2FF] border border-[#00D2FF]/20">
            {sourceType === "ai_vision" ? "AI Vision" : `${sourceType} · deterministic`}
          </span>
          {coverage && Object.entries(coverage).map(([k, v]) => (
            <span key={k} className="px-2 py-0.5 rounded bg-white/5 text-gray-500 border border-white/10">
              {k.replace(/_/g, " ")}: {String(v)}
            </span>
          ))}
        </div>
      )}

      {/* AI vision fallback - only when graphical PDF pages had no readable tables */}
      {phase === "done" && aiPages.length > 0 && (hasLocalPdf || aiPageRefs.length > 0) && (
        <div className="rounded-xl border border-[#CCFF00]/20 bg-[#CCFF00]/[0.04] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <p className="text-xs text-white font-bold">
              {aiPages.length} drawing page{aiPages.length !== 1 ? "s" : ""} had no machine-readable tables
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Pages {aiPages.slice(0, 12).join(", ")}{aiPages.length > 12 ? "..." : ""} - these are graphical drawings.
              Run AI vision to measure quantities from them. This is the only step that uses tokens.
            </p>
          </div>
          <button
            onClick={runAiFallback}
            disabled={aiRunning}
            className="shrink-0 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
          >
            {aiRunning ? "Reading drawings..." : `Run AI on ${aiPages.length} page${aiPages.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {/* KPI bar */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Line Items",    value: rows.length.toLocaleString(),      accent: "lime" },
            { label: "CSI Divisions", value: divisions.length.toString(),       accent: "white" },
            { label: "Failed Rows",   value: failedRows.toString(),             accent: failedRows > 0 ? "red" : "white" },
            { label: "Audit Status",  value: phase === "done" ? "PASS" : "...", accent: "white" },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-white/10 bg-[#0E0F12] px-4 py-3">
              <p className={`text-xl font-black ${
                k.accent === "lime" ? "text-[#CCFF00]" :
                k.accent === "red"  ? "text-[#E50914]" :
                "text-white"
              }`}>
                {k.value}
              </p>
              <p className="text-[10px] uppercase tracking-widest text-gray-600 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {phase === "done" && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#CCFF00] font-mono">What next</p>
              <p className="mt-1 text-sm text-white/75">
                Review the line items, then open the canvas to trace more measurements or go back to documents for another file.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/dashboard/projects/${projectId}?phase=Documents&sub=documents`}
                className="inline-flex h-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.03] px-4 text-[11px] font-semibold uppercase tracking-widest text-white/75 hover:border-white/25 hover:text-white"
              >
                Open documents
              </Link>
              <Link
                href={`/dashboard/projects/${projectId}/takeoff/canvas`}
                className="inline-flex h-9 items-center justify-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-semibold uppercase tracking-widest text-black hover:opacity-90"
              >
                Open canvas
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Division cards */}
      {divisions.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">By Division</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {divisions.map((d) => <DivisionCard key={d.code} div={d} />)}
          </div>
        </div>
      )}

      {/* Full grid */}
      {rows.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">Line Items</p>
          <TakeoffGrid rows={rows} />
        </div>
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title="Delete saved item?"
          body={`This will remove "${deleteTarget.label ?? "this item"}" from the takeoff list. The item can be recreated, but this copy will be removed now.`}
          confirming={deletingId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await deleteSavedItem(deleteTarget.id);
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






