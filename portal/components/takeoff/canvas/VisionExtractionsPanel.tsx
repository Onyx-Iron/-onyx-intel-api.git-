"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 * Findings are committed automatically by the API into takeoff_items (and
 * from there into the estimate) as soon as extraction runs — no manual
 * per-item approval gate. Low-confidence / AI-vision items still land with
 * pricing_status "review" downstream so an estimator can catch a bad read
 * before it's treated as verified, but they don't require a click just to
 * exist in the takeoff.
 */
export default function VisionExtractionsPanel({ pageId, vectorDescriptions, onCommitted }: Props) {
  const [state, setState] = useState<{ result: VisionResult | null; loading: boolean; err: string | null }>({ result: null, loading: true, err: null });
  const [open, setOpen] = useState(true);
  const notifiedKey = useRef<string | null>(null);

  const runExtract = useCallback(async (force: boolean) => {
    setState((s) => ({ ...s, loading: true, err: null }));
    try {
      const res = await fetch("/api/takeoff/canvas/vision-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_id: pageId, force }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status));
      const data = await res.json() as { result: VisionResult };
      setState({ result: data.result, loading: false, err: null });
    } catch (e) {
      setState({ result: null, loading: false, err: e instanceof Error ? e.message : String(e) });
    }
  }, [pageId]);

  // On mount: check cache; if missing, run extraction.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await fetch(`/api/takeoff/canvas/vision-extract?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" });
        if (!cached.ok) throw new Error(String(cached.status));
        const data = await cached.json() as { result: VisionResult | null };
        if (data.result) {
          if (!cancelled) setState({ result: data.result, loading: false, err: null });
          return;
        }
        if (!cancelled) void runExtract(false);
      } catch (e) {
        if (!cancelled) setState({ result: null, loading: false, err: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [pageId, runExtract]);

  // ── Cross-reference each vision item against vector descriptions ─────────
  const enriched = useMemo(() => {
    if (!state.result) return [];
    const vecKeywords = vectorDescriptions.map((d) => d.toLowerCase());
    return state.result.items.map((it) => {
      const desc = it.description.toLowerCase();
      const matched = vecKeywords.some((v) => v && (desc.includes(v.slice(0, Math.min(20, v.length))) || v.includes(desc.slice(0, 20))));
      return { ...it, cross_verified: matched };
    });
  }, [state.result, vectorDescriptions]);

  // The API auto-commits every item into takeoff_items as soon as extraction
  // runs. Notify the parent once per result so the canvas shapes dock stays
  // in sync without requiring a manual approve click.
  useEffect(() => {
    if (!state.result || !onCommitted) return;
    const key = state.result.extracted_at;
    if (notifiedKey.current === key) return;
    notifiedKey.current = key;
    for (const it of state.result.items) onCommitted(it);
  }, [state.result, onCommitted]);

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
             `${enriched.length} finding${enriched.length === 1 ? "" : "s"} — added to takeoff`}
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
            const needsReview = it.confidence < 0.65;
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
                  <span
                    className={`ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                      needsReview ? "bg-amber-400/20 text-amber-300" : "bg-[#CCFF00]/20 text-[#CCFF00]"
                    }`}
                    title={needsReview ? "Low-confidence AI read — flagged for review in the estimate" : "Added to takeoff"}
                  >
                    {needsReview ? "Needs review" : "Added"}
                  </span>
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
