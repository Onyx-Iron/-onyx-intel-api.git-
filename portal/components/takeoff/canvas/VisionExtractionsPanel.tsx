"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface VisionItem {
  description: string;
  quantity: number;
  unit: string;
  cost_code?: string;
  layer_hint?: string;
  source: "schedule" | "note" | "callout" | "image" | "text";
  confidence: number;
  raw_text?: string;
}

interface VisionResult {
  items: VisionItem[];
  page_summary: string;
  extracted_at: string;
  model: string;
}

interface TakeoffItemRef {
  id: string;
  review_status: "suggested" | "reviewed" | "approved" | "rejected" | string;
  rejected_reason: string | null;
}

// "suggested" and "reviewed" both still need an approve/reject decision —
// neither can affect the estimate yet.
function needsDecision(status: string): boolean {
  return status === "suggested" || status === "reviewed";
}

interface Props {
  pageId: string;
  projectId: string;
  /** Descriptions the CAD vector layer already saw — used for cross-reference verification. */
  vectorDescriptions: string[];
  onCommitted?: (approved: VisionItem) => void;
}

/**
 * Right-side panel listing every schedule / note / callout / image finding
 * Gemini pulled from the page, cross-referenced against vector-derived
 * findings from the CAD Vector Layer.
 *
 * Every finding is committed into takeoff_items as soon as extraction runs
 * (visible in the takeoff grid immediately), but with review_status
 * "suggested" — it is EXCLUDED from the estimate until a human explicitly
 * approves or rejects it here. Rejected items stay in takeoff_items
 * (permanently auditable) but can never reach the estimate.
 */
export default function VisionExtractionsPanel({ pageId, vectorDescriptions, onCommitted }: Props) {
  const [state, setState] = useState<{ result: VisionResult | null; loading: boolean; err: string | null }>({ result: null, loading: true, err: null });
  const [takeoffItems, setTakeoffItems] = useState<TakeoffItemRef[]>([]);
  const [open, setOpen] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const runExtract = useCallback(async (force: boolean) => {
    setState((s) => ({ ...s, loading: true, err: null }));
    try {
      const res = await fetch("/api/takeoff/canvas/vision-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_id: pageId, force }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status));
      const data = await res.json() as { result: VisionResult; takeoffItems?: TakeoffItemRef[] };
      setState({ result: data.result, loading: false, err: null });
      setTakeoffItems(data.takeoffItems ?? []);
      if (onCommitted) for (const it of data.result.items) onCommitted(it);
    } catch (e) {
      setState({ result: null, loading: false, err: e instanceof Error ? e.message : String(e) });
    }
  }, [pageId, onCommitted]);

  // On mount: check cache; if missing, run extraction.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await fetch(`/api/takeoff/canvas/vision-extract?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" });
        if (!cached.ok) throw new Error(String(cached.status));
        const data = await cached.json() as { result: VisionResult | null; takeoffItems?: TakeoffItemRef[] };
        if (data.result) {
          if (!cancelled) {
            setState({ result: data.result, loading: false, err: null });
            setTakeoffItems(data.takeoffItems ?? []);
          }
          return;
        }
        if (!cancelled) void runExtract(false);
      } catch (e) {
        if (!cancelled) setState({ result: null, loading: false, err: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [pageId, runExtract]);

  // ── Cross-reference each vision item against vector descriptions, and
  // line it up with its takeoff_items row (same insertion order) ─────────
  const enriched = useMemo(() => {
    if (!state.result) return [];
    const vecKeywords = vectorDescriptions.map((d) => d.toLowerCase());
    return state.result.items.map((it, i) => {
      const desc = it.description.toLowerCase();
      const matched = vecKeywords.some((v) => v && (desc.includes(v.slice(0, Math.min(20, v.length))) || v.includes(desc.slice(0, 20))));
      return { ...it, cross_verified: matched, takeoffRef: takeoffItems[i] as TakeoffItemRef | undefined };
    });
  }, [state.result, vectorDescriptions, takeoffItems]);

  const review = useCallback(async (takeoffId: string, action: "approve" | "reject") => {
    setActing(takeoffId);
    try {
      const res = await fetch(`/api/takeoff/items/${encodeURIComponent(takeoffId)}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status));
      setTakeoffItems((prev) => prev.map((r) => r.id === takeoffId ? { ...r, review_status: action === "approve" ? "approved" : "rejected" } : r));
    } catch {
      // Leave state as-is on failure — the badge stays "pending review" so the user can retry.
    } finally {
      setActing(null);
    }
  }, []);

  const pendingCount = takeoffItems.filter((r) => needsDecision(r.review_status)).length;

  return (
    <div className="border-b border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-white/[0.02]"
      >
        <div className="text-left">
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Schedules · Notes · Images</div>
          <div className="text-sm font-semibold">
            {state.loading ? "Reading page…" :
             state.err     ? "Extraction failed" :
             enriched.length === 0 ? "No takeoff items detected" :
             pendingCount > 0 ? `${enriched.length} finding${enriched.length === 1 ? "" : "s"} — ${pendingCount} awaiting review` :
             `${enriched.length} finding${enriched.length === 1 ? "" : "s"} reviewed`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state.result && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void runExtract(true); }}
              className="text-[9px] font-mono uppercase tracking-widest text-white/40 hover:text-[#CCFF00]"
              title="Re-run vision extraction (replaces previously added items for this page)"
            >
              refresh
            </button>
          )}
          <svg width="10" height="10" viewBox="0 0 12 12" className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {state.err && (
            <div className="text-[11px] text-red-400 px-2 py-2">
              {state.err}
              <button type="button" onClick={() => void runExtract(true)} className="ml-2 text-[#CCFF00]">retry</button>
            </div>
          )}
          {state.result?.page_summary && (
            <div className="text-[10px] italic text-white/40 px-2 py-1 border-l-2 border-white/10">
              {state.result.page_summary}
            </div>
          )}
          {enriched.length === 0 && !state.loading && !state.err && (
            <div className="text-[11px] text-white/30 px-2 py-3 text-center">
              Nothing quantifiable on this sheet.
            </div>
          )}
          {enriched.map((it, i) => {
            const tone =
              it.source === "schedule" ? "text-cyan-400" :
              it.source === "callout"  ? "text-[#CCFF00]" :
              it.source === "image"    ? "text-orange-400" :
              it.source === "note"     ? "text-amber-400" :
                                         "text-white/50";
            const status = it.takeoffRef?.review_status ?? "suggested";
            const isActing = it.takeoffRef && acting === it.takeoffRef.id;
            return (
              <div
                key={`${it.description}-${i}`}
                className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] uppercase tracking-widest font-mono ${tone}`}>{it.source}</span>
                  {it.cross_verified && (
                    <span
                      title="Cross-referenced with a vector on this sheet"
                      className="text-[9px] uppercase tracking-widest font-mono text-[#CCFF00]"
                    >
                      ✓ verified
                    </span>
                  )}
                  <span className={`ml-auto text-[10px] font-mono ${confidenceTone(it.confidence)}`}>
                    {(it.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 text-xs text-white leading-snug">
                  <span className="font-mono">{it.quantity.toLocaleString()} {it.unit}</span>
                  <span className="mx-1 text-white/40">·</span>
                  {it.description}
                </div>
                {it.raw_text && (
                  <div className="mt-1 text-[10px] italic text-white/40 line-clamp-1">&ldquo;{it.raw_text}&rdquo;</div>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  {it.cost_code && (
                    <span className="text-[10px] font-mono text-white/40">{it.cost_code}</span>
                  )}
                  {needsDecision(status) && it.takeoffRef ? (
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isActing}
                        onClick={() => void review(it.takeoffRef!.id, "reject")}
                        className="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-red-300 hover:border-red-300/40 disabled:opacity-40"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={isActing}
                        onClick={() => void review(it.takeoffRef!.id, "approve")}
                        className="rounded-full bg-[#CCFF00] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40"
                      >
                        {isActing ? "…" : "Approve"}
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                        status === "rejected" ? "bg-red-400/20 text-red-300" : "bg-[#CCFF00]/20 text-[#CCFF00]"
                      }`}
                      title={status === "rejected" ? "Excluded from the estimate" : "Approved — included in the estimate"}
                    >
                      {status === "rejected" ? "Rejected" : "Approved"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function confidenceTone(c: number): string {
  if (c >= 0.85) return "text-[#CCFF00]";
  if (c >= 0.65) return "text-amber-400";
  return "text-white/50";
}
