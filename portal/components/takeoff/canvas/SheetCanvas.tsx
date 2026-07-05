"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CADVectorLayer from "./CADVectorLayer";
import VisionExtractionsPanel from "./VisionExtractionsPanel";
import { extractVectorsFromPdfPage } from "@/lib/cad/pdf-vector-extract";
import { classifyLayer } from "@/lib/cad/layer-classify";
import { calcPipeEmbedment } from "@/lib/math/civil-scope";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Tool = "pan" | "calibrate" | "count" | "length" | "area" | "utility_pipe";

interface Pt { x: number; y: number }

interface Shape {
  key: string;                // client-side id
  tool: "count" | "length" | "area";
  points: Pt[];               // canvas pixel coords
  quantity: number;           // computed (count: N; length: LF; area: SF)
  unit: "EA" | "LF" | "SF";
  cost_code?: string;
  saved?: boolean;            // has been persisted to manual_takeoffs
}

const SYSTEM_TYPES = ["Sanitary Sewer", "Storm Drain", "Water Line", "Fire Line"] as const;
type SystemType = typeof SYSTEM_TYPES[number];

interface UtilityRunInputs {
  system_type: SystemType;
  pipe_diameter_in: number;
  invert_elevation_start: number;
  invert_elevation_end: number;
  trench_width_ft: number;
}

interface TrenchYield {
  trench_excavation_bcy: number;
  bedding_material_cy: number;
  native_backfill_cy: number;
}

interface UtilityRun {
  key: string;
  id?: string;                // server id once saved
  points: Pt[];                // canvas pixel coords
  run_length_lf: number;
  inputs: UtilityRunInputs;
  trench: TrenchYield;
  cost_code?: string;
  saved?: boolean;
}

interface Calibration {
  scale_ratio: number;        // real-units per canvas pixel
  unit_type: string;          // "LF"
}

interface Props {
  projectId: string;
  projectName: string;
  pageId: string;
  pageNumber: number;
  documentId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function SheetCanvas({ projectId, projectName, pageId, pageNumber }: Props) {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfUrl, setPdfUrl]         = useState<string | null>(null);
  const [renderSize, setRenderSize] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool]             = useState<Tool>("pan");
  const [shapes, setShapes]         = useState<Shape[]>([]);
  const [draftPoints, setDraftPoints] = useState<Pt[]>([]);   // in-progress polygon/line points
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibPts, setCalibPts]     = useState<Pt[]>([]);     // during calibrate mode
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [vectorDescriptions, setVectorDescriptions] = useState<string[]>([]);
  const [utilityRuns, setUtilityRuns] = useState<UtilityRun[]>([]);
  const [utilityDraftPts, setUtilityDraftPts] = useState<Pt[]>([]);
  const [utilityModalPts, setUtilityModalPts] = useState<Pt[] | null>(null); // non-null while the input overlay is open

  // ── Load signed URL + existing calibration + saved takeoffs ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [urlRes, calRes, mtRes, utRes] = await Promise.all([
          fetch(`/api/takeoff/canvas/page-url?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/calibration?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/manual?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/utility?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
        ]);
        if (!urlRes.ok) throw new Error(`page-url ${urlRes.status}`);
        const urlData = await urlRes.json() as { url: string };
        if (!cancelled) setPdfUrl(urlData.url);

        if (calRes.ok) {
          const calData = await calRes.json() as { calibration: Calibration | null };
          if (!cancelled) setCalibration(calData.calibration);
        }
        if (mtRes.ok) {
          const mtData = await mtRes.json() as { items: Array<{ id: string; takeoff_type: "count" | "length" | "area"; cost_code: string | null; quantity: number; unit: string | null; geometry: { points?: Pt[] } }> };
          if (!cancelled) {
            setShapes(mtData.items.map((it, i) => ({
              key: `saved-${it.id}`,
              tool: it.takeoff_type,
              points: Array.isArray(it.geometry?.points) ? it.geometry.points : [],
              quantity: Number(it.quantity),
              unit: (it.unit ?? (it.takeoff_type === "count" ? "EA" : it.takeoff_type === "length" ? "LF" : "SF")) as Shape["unit"],
              cost_code: it.cost_code ?? undefined,
              saved: true,
            })).filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)); // dedupe by key
          }
        }
        if (utRes.ok) {
          type SavedUtilityRow = {
            id: string; system_type: string; pipe_diameter_in: number;
            invert_elevation_start: number | null; invert_elevation_end: number | null;
            trench_width_ft: number; run_length_lf: number;
            cost_code: string | null; geometry: { points?: Pt[] } | null;
            computed_trench_json: { trench_excavation_bcy?: number; common_backfill_cy?: number; totals?: { aggregate_import_cy?: number } } | null;
          };
          const utData = await utRes.json() as { items: SavedUtilityRow[] };
          if (!cancelled) {
            setUtilityRuns(utData.items.map((it) => ({
              key: `saved-${it.id}`,
              id: it.id,
              points: Array.isArray(it.geometry?.points) ? it.geometry!.points! : [],
              run_length_lf: Number(it.run_length_lf),
              inputs: {
                system_type: it.system_type as SystemType,
                pipe_diameter_in: it.pipe_diameter_in,
                invert_elevation_start: it.invert_elevation_start ?? 0,
                invert_elevation_end: it.invert_elevation_end ?? 0,
                trench_width_ft: it.trench_width_ft,
              },
              trench: {
                trench_excavation_bcy: it.computed_trench_json?.trench_excavation_bcy ?? 0,
                bedding_material_cy: it.computed_trench_json?.totals?.aggregate_import_cy ?? 0,
                native_backfill_cy: it.computed_trench_json?.common_backfill_cy ?? 0,
              },
              cost_code: it.cost_code ?? undefined,
              saved: true,
            })));
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [pageId, projectId]);

  // ── Render the PDF page onto <canvas> via pdfjs-dist ──────────────────────
  //
  // After render, kick off a one-time PDF vector extraction for the page if
  // no CAD vectors have been persisted yet. This makes civil takeoffs work
  // from vector-authored PDFs (Bluebeam / Civil 3D exports) not just DWG/DXF.
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({ url: pdfUrl }).promise;
        const page = await doc.getPage(1);

        const containerWidth = wrapRef.current?.clientWidth ?? 1200;
        const viewport1 = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, Math.max(0.5, (containerWidth - 380) / viewport1.width));
        const viewport = page.getViewport({ scale });

        const cvs = canvasRef.current;
        if (!cvs || cancelled) return;
        cvs.width = viewport.width;
        cvs.height = viewport.height;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport, canvas: cvs }).promise;
        if (!cancelled) setRenderSize({ w: viewport.width, h: viewport.height });

        // ── PDF vector extraction (once per page) ─────────────────────────
        // Check if vectors already exist server-side; if not, extract + PUT.
        try {
          const check = await fetch(
            `/api/takeoff/canvas/vectors?page_id=${encodeURIComponent(pageId)}`,
            { cache: "no-store" },
          );
          const existing = check.ok ? (await check.json() as { vectors?: unknown[] }) : { vectors: [] };
          if ((existing.vectors ?? []).length === 0) {
            const vectors = await extractVectorsFromPdfPage(page);
            if (vectors.length > 0 && !cancelled) {
              await fetch("/api/takeoff/canvas/vectors", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ page_id: pageId, vectors }),
              });
              // Nudge the CAD overlay to re-fetch — a small delay ensures the
              // PUT has landed before the overlay's GET runs.
              window.setTimeout(() => window.dispatchEvent(new CustomEvent("onyx:cad-vectors-refresh", { detail: { pageId } })), 300);
            }
          }
        } catch (extractErr) {
          console.warn("[SheetCanvas] PDF vector extraction skipped:", extractErr);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, pageId]);

  // ── Coordinate conversion (SVG uses canvas pixel space directly) ──────────
  const toLocal = useCallback((clientX: number, clientY: number, svgEl: SVGSVGElement): Pt => {
    const rect = svgEl.getBoundingClientRect();
    const w = renderSize?.w ?? rect.width;
    const h = renderSize?.h ?? rect.height;
    return {
      x: ((clientX - rect.left) / rect.width) * w,
      y: ((clientY - rect.top) / rect.height) * h,
    };
  }, [renderSize]);

  // ── Geometry helpers ──────────────────────────────────────────────────────
  const scale = calibration?.scale_ratio ?? 1;
  const pixelDistance = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const totalLen = (pts: Pt[]) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += pixelDistance(pts[i - 1], pts[i]);
    return s;
  };
  const polygonArea = (pts: Pt[]) => {
    if (pts.length < 3) return 0;
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  };

  // Preview quantity for the in-progress draft (before commit).
  const draftQuantity = useMemo(() => {
    if (draftPoints.length === 0) return 0;
    if (tool === "length") return totalLen(draftPoints) * scale;
    if (tool === "area")   return polygonArea(draftPoints) * scale * scale;
    return 0;
  }, [draftPoints, tool, scale]);

  // ── Click handling ────────────────────────────────────────────────────────
  const onCanvasClick: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!renderSize) return;
    const p = toLocal(e.clientX, e.clientY, e.currentTarget);

    if (tool === "calibrate") {
      const next = [...calibPts, p];
      if (next.length === 2) {
        const raw = window.prompt("Enter the real-world distance between the two clicks (feet):", "10");
        if (raw != null) {
          const feet = Number(raw);
          if (Number.isFinite(feet) && feet > 0) {
            const px = pixelDistance(next[0], next[1]);
            if (px > 0) saveCalibration(feet / px);
          }
        }
        setCalibPts([]);
        setTool("pan");
      } else {
        setCalibPts(next);
      }
      return;
    }

    if (tool === "count") {
      const shape: Shape = {
        key: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tool: "count",
        points: [p],
        quantity: 1,
        unit: "EA",
      };
      setShapes((prev) => [...prev, shape]);
      return;
    }

    if (tool === "length" || tool === "area") {
      setDraftPoints((prev) => [...prev, p]);
    }

    if (tool === "utility_pipe") {
      setUtilityDraftPts((prev) => [...prev, p]);
    }
  };

  const finishUtilityDraft = useCallback(() => {
    if (utilityDraftPts.length < 2) { setUtilityDraftPts([]); return; }
    setUtilityModalPts(utilityDraftPts); // hand off to the input overlay; cleared on submit/cancel
  }, [utilityDraftPts]);

  // Trench cover isn't captured by the modal (only inverts/diameter/width) —
  // mirrors the server-side DEFAULT_COVER_FT assumption in the API route so
  // the client preview matches what actually gets persisted.
  const DEFAULT_COVER_FT = 4;

  const commitUtilityRun = useCallback((inputs: UtilityRunInputs) => {
    if (!utilityModalPts) return;
    const lengthLf = totalLen(utilityModalPts) * scale;
    const trenchFull = calcPipeEmbedment({
      length_lf: lengthLf,
      diameter_in: inputs.pipe_diameter_in,
      trench_width_ft: inputs.trench_width_ft,
      avg_depth_ft: DEFAULT_COVER_FT,
    });
    const run: UtilityRun = {
      key: `u-${Date.now()}`,
      points: utilityModalPts,
      run_length_lf: lengthLf,
      inputs,
      trench: {
        trench_excavation_bcy: trenchFull.trench_excavation_bcy,
        bedding_material_cy: trenchFull.totals.aggregate_import_cy,
        native_backfill_cy: trenchFull.common_backfill_cy,
      },
    };
    setUtilityRuns((prev) => [...prev, run]);
    setUtilityModalPts(null);
    setUtilityDraftPts([]);
  }, [utilityModalPts, scale]);

  const finishDraft = useCallback(() => {
    if (tool === "utility_pipe") { finishUtilityDraft(); return; }
    if (draftPoints.length < 2) { setDraftPoints([]); return; }
    if (tool === "length") {
      const quantity = totalLen(draftPoints) * scale;
      setShapes((prev) => [...prev, {
        key: `l-${Date.now()}`,
        tool: "length",
        points: draftPoints,
        quantity,
        unit: "LF",
      }]);
    } else if (tool === "area" && draftPoints.length >= 3) {
      const quantity = polygonArea(draftPoints) * scale * scale;
      setShapes((prev) => [...prev, {
        key: `a-${Date.now()}`,
        tool: "area",
        points: draftPoints,
        quantity,
        unit: "SF",
      }]);
    }
    setDraftPoints([]);
  }, [draftPoints, tool, scale]);

  // Escape/Enter shortcuts for finishing a polygon/line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDraftPoints([]); setCalibPts([]); setUtilityDraftPts([]); }
      else if (e.key === "Enter") finishDraft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft]);

  // ── Persistence ───────────────────────────────────────────────────────────
  async function saveCalibration(ratio: number) {
    const res = await fetch("/api/takeoff/canvas/calibration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: pageId, scale_ratio: ratio, unit_type: "LF" }),
    });
    if (res.ok) {
      const data = await res.json() as { calibration: Calibration };
      setCalibration(data.calibration);
    }
  }

  async function saveAllUnsaved() {
    const unsaved = shapes.filter((s) => !s.saved);
    const unsavedRuns = utilityRuns.filter((r) => !r.saved);
    if (unsaved.length === 0 && unsavedRuns.length === 0) return;
    setSaving(true);
    try {
      const requests: Promise<Response>[] = [];

      if (unsaved.length > 0) {
        const items = unsaved.map((s) => ({
          project_id: projectId,
          page_id: pageId,
          cost_code: s.cost_code || null,
          takeoff_type: s.tool,
          quantity: Number(s.quantity.toFixed(3)),
          unit: s.unit,
          geometry: { points: s.points, page_number: pageNumber },
        }));
        requests.push(fetch("/api/takeoff/canvas/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        }));
      }

      if (unsavedRuns.length > 0) {
        const items = unsavedRuns.map((r) => ({
          project_id: projectId,
          page_id: pageId,
          cost_code: r.cost_code || null,
          system_type: r.inputs.system_type,
          pipe_diameter_in: r.inputs.pipe_diameter_in,
          invert_elevation_start: r.inputs.invert_elevation_start,
          invert_elevation_end: r.inputs.invert_elevation_end,
          trench_width_ft: r.inputs.trench_width_ft,
          run_length_lf: r.run_length_lf,
          geometry: { points: r.points, page_number: pageNumber },
        }));
        requests.push(fetch("/api/takeoff/canvas/utility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        }));
      }

      const results = await Promise.all(requests);
      const allOk = results.every((r) => r.ok);
      if (allOk) {
        setShapes((prev) => prev.map((s) => (s.saved ? s : { ...s, saved: true })));
        setUtilityRuns((prev) => prev.map((r) => (r.saved ? r : { ...r, saved: true })));
      } else {
        const failed = results.find((r) => !r.ok);
        const err = failed ? await failed.json().catch(() => ({})) : {};
        alert(`Save failed: ${err.error ?? failed?.status}`);
      }
    } finally {
      setSaving(false);
    }
  }

  function updateCostCode(key: string, code: string) {
    setShapes((prev) => prev.map((s) => (s.key === key ? { ...s, cost_code: code, saved: false } : s)));
  }
  function removeShape(key: string) {
    setShapes((prev) => prev.filter((s) => s.key !== key));
  }
  function updateUtilityCostCode(key: string, code: string) {
    setUtilityRuns((prev) => prev.map((r) => (r.key === key ? { ...r, cost_code: code, saved: false } : r)));
  }
  function removeUtilityRun(key: string) {
    setUtilityRuns((prev) => prev.filter((r) => r.key !== key));
  }

  const totals = useMemo(() => {
    let count = 0, len = 0, area = 0;
    for (const s of shapes) {
      if (s.tool === "count")  count += 1;
      if (s.tool === "length") len   += s.quantity;
      if (s.tool === "area")   area  += s.quantity;
    }
    return { count, len, area };
  }, [shapes]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full bg-[#06070A] text-white">
      {/* Left: canvas workspace */}
      <div ref={wrapRef} className="relative flex-1 overflow-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#06070A]/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-4">
            <Link
              href={`/dashboard/projects/${projectId}`}
              className="text-[11px] font-semibold uppercase tracking-widest text-white/50 hover:text-white"
            >
              ← Back
            </Link>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Sheet Canvas</div>
              <div className="text-sm font-semibold">
                {projectName} <span className="text-white/40 font-normal">· Page {pageNumber}</span>
              </div>
            </div>
          </div>

          {/* Tool switcher */}
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
            {(["pan", "calibrate", "count", "length", "area", "utility_pipe"] as Tool[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTool(t); setDraftPoints([]); setCalibPts([]); setUtilityDraftPts([]); }}
                className={`px-3 h-7 text-[10px] uppercase tracking-widest font-mono rounded-full transition-colors ${
                  tool === t
                    ? "bg-[#CCFF00] text-black"
                    : "text-white/60 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">
            {calibration
              ? <>Scale · <span className="text-[#CCFF00]">{calibration.scale_ratio.toFixed(4)} ft/px</span></>
              : <span className="text-amber-400">Not calibrated — pick <b>calibrate</b> tool</span>}
          </div>
        </div>

        {/* PDF + overlay */}
        <div className="relative mx-auto my-4 w-max">
          <canvas ref={canvasRef} className="block rounded-md shadow-2xl" />
          {renderSize && (
            <svg
              width={renderSize.w}
              height={renderSize.h}
              viewBox={`0 0 ${renderSize.w} ${renderSize.h}`}
              className={`absolute inset-0 select-none ${tool === "pan" ? "cursor-grab" : "cursor-crosshair"}`}
              onClick={onCanvasClick}
              onDoubleClick={finishDraft}
            >
              {/* Committed shapes */}
              {shapes.map((s) => {
                const isSel = s.key === selectedKey;
                const color = s.tool === "count" ? "#CCFF00" : s.tool === "length" ? "#00D2FF" : "#f97316";
                if (s.tool === "count") {
                  const p = s.points[0];
                  return (
                    <g key={s.key} onClick={(e) => { e.stopPropagation(); setSelectedKey(s.key); }}>
                      <circle cx={p.x} cy={p.y} r={isSel ? 9 : 7} fill={color} stroke="#000" strokeWidth={2} />
                    </g>
                  );
                }
                if (s.tool === "length") {
                  const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
                  return (
                    <g key={s.key} onClick={(e) => { e.stopPropagation(); setSelectedKey(s.key); }}>
                      <path d={d} stroke={color} strokeWidth={isSel ? 4 : 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  );
                }
                // area
                const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
                return (
                  <g key={s.key} onClick={(e) => { e.stopPropagation(); setSelectedKey(s.key); }}>
                    <path d={d} fill={`${color}44`} stroke={color} strokeWidth={isSel ? 3 : 2} />
                  </g>
                );
              })}

              {/* Committed utility pipe runs */}
              {utilityRuns.map((u) => {
                const d = u.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
                return (
                  <g key={u.key}>
                    <path d={d} stroke="#a855f7" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 4" />
                    {u.points.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#a855f7" stroke="#000" strokeWidth={1} />
                    ))}
                  </g>
                );
              })}

              {/* Draft (in-progress) utility pipe run */}
              {tool === "utility_pipe" && utilityDraftPts.length > 0 && (
                <g>
                  <path
                    d={utilityDraftPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")}
                    stroke="#a855f7"
                    strokeWidth={3}
                    strokeDasharray="6 4"
                    fill="none"
                  />
                  {utilityDraftPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#a855f7" strokeWidth={1.5} />
                  ))}
                </g>
              )}

              {/* Draft (in-progress) polyline / polygon */}
              {draftPoints.length > 0 && (
                <g>
                  <path
                    d={draftPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + (tool === "area" && draftPoints.length >= 3 ? " Z" : "")}
                    stroke={tool === "area" ? "#f97316" : "#00D2FF"}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    fill={tool === "area" ? "#f9731633" : "none"}
                  />
                  {draftPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#000" strokeWidth={1} />
                  ))}
                </g>
              )}

              {/* Calibration guide */}
              {calibPts.length > 0 && (
                <g>
                  {calibPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={5} fill="#CCFF00" stroke="#000" strokeWidth={1} />
                  ))}
                </g>
              )}
            </svg>
          )}

          {/* CAD vector layer — rendered atop the PDF, below the tool overlay */}
          <CADVectorLayer
            pageId={pageId}
            projectId={projectId}
            canvasSize={renderSize}
            scaleRatio={calibration?.scale_ratio ?? 1}
            onVectorsLoaded={setVectorDescriptions}
            onCommitted={(m) => {
              // Mirror an approved CAD vector into the local shapes dock so
              // estimators see it immediately without needing to reload.
              setShapes((prev) => [...prev, {
                key: `cad-${Date.now()}`,
                tool: m.takeoff_type,
                points: Array.isArray((m.geometry as { points?: { x: number; y: number }[] })?.points)
                  ? ((m.geometry as { points: { x: number; y: number }[] }).points)
                  : [],
                quantity: m.quantity,
                unit: m.unit,
                cost_code: m.cost_code,
                saved: true,
              }]);
            }}
          />

          {!renderSize && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/40">
              Rendering sheet…
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400 p-6 text-center">
              Couldn&apos;t load the sheet: {loadError}
            </div>
          )}
        </div>

        {tool === "utility_pipe" && utilityDraftPts.length > 0 && (
          <div className="fixed bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-black/80 px-3 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Pipe Run Draft</div>
            <div className="mt-0.5 text-sm">
              <span className="text-[#a855f7] font-mono">{(totalLen(utilityDraftPts) * scale).toFixed(2)}</span> LF
              <span className="ml-3 text-[10px] text-white/40">Enter/double-click = configure run · Esc = cancel</span>
            </div>
          </div>
        )}

        {(tool === "length" || tool === "area") && draftPoints.length > 0 && (
          <div className="fixed bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-black/80 px-3 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Draft</div>
            <div className="mt-0.5 text-sm">
              {tool === "length"
                ? <><span className="text-[#00D2FF] font-mono">{draftQuantity.toFixed(2)}</span> LF</>
                : <><span className="text-orange-400 font-mono">{draftQuantity.toFixed(2)}</span> SF</>
              }
              <span className="ml-3 text-[10px] text-white/40">Enter = commit · Esc = cancel</span>
            </div>
          </div>
        )}
      </div>

      {/* Right: dock */}
      <aside className="w-[360px] shrink-0 border-l border-white/10 bg-[#0E0F12] flex flex-col">
        <VisionExtractionsPanel
          pageId={pageId}
          projectId={projectId}
          vectorDescriptions={vectorDescriptions}
          onCommitted={(vi) => {
            setShapes((prev) => [...prev, {
              key: `vision-${Date.now()}`,
              tool: vi.unit === "EA" ? "count" : vi.unit === "SF" || vi.unit === "CY" ? "area" : "length",
              points: [],
              quantity: vi.quantity,
              unit: (vi.unit === "EA" || vi.unit === "SF" || vi.unit === "LF") ? vi.unit as "EA"|"SF"|"LF" : "EA",
              cost_code: vi.cost_code,
              saved: true,
            }]);
          }}
        />
        <div className="border-b border-white/10 px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Measurements</div>
          <div className="mt-1 text-sm font-semibold">
            {shapes.length} item{shapes.length === 1 ? "" : "s"}
            <span className="text-white/40 font-normal"> · {totals.count} EA · {totals.len.toFixed(1)} LF · {totals.area.toFixed(1)} SF</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {shapes.length === 0 && (
            <div className="text-xs text-white/40 px-2 py-4 text-center">
              No measurements yet. Pick a tool, click the sheet.
            </div>
          )}
          {shapes.map((s) => {
            const color = s.tool === "count" ? "text-[#CCFF00]" : s.tool === "length" ? "text-[#00D2FF]" : "text-orange-400";
            const isSel = s.key === selectedKey;
            return (
              <div
                key={s.key}
                onClick={() => setSelectedKey(s.key)}
                className={`rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  isSel ? "border-white/25 bg-white/[0.04]" : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] uppercase tracking-widest font-mono ${color}`}>{s.tool}</span>
                    <span className="text-sm font-mono">
                      {s.quantity.toFixed(2)} <span className="text-white/40">{s.unit}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeShape(s.key); }}
                    className="text-[10px] text-white/30 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="NN-NN-NN"
                    value={s.cost_code ?? ""}
                    onChange={(e) => updateCostCode(s.key, e.target.value)}
                    className={`flex-1 rounded border px-2 py-1 text-[11px] font-mono bg-black/40 focus:outline-none focus:border-[#CCFF00] ${
                      s.cost_code && !/^\d{2}-\d{2}-\d{2}$/.test(s.cost_code)
                        ? "border-red-400/50"
                        : "border-white/10"
                    }`}
                  />
                  {s.saved && (
                    <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Saved</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {utilityRuns.length > 0 && (
          <div className="border-t border-white/10 px-3 py-2 space-y-1.5 max-h-[35vh] overflow-y-auto">
            <div className="px-1 text-[10px] uppercase tracking-widest font-mono text-[#a855f7]">
              Utility Pipe Runs · {utilityRuns.length}
            </div>
            {utilityRuns.map((r) => (
              <div key={r.key} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[9px] uppercase tracking-widest font-mono text-[#a855f7]">{r.inputs.system_type}</span>
                    <div className="text-sm font-mono">
                      {r.run_length_lf.toFixed(1)} <span className="text-white/40">LF</span>
                      <span className="text-white/40 text-xs"> · {r.inputs.pipe_diameter_in}&quot; Ø</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => removeUtilityRun(r.key)} className="text-[10px] text-white/30 hover:text-red-400">✕</button>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] font-mono text-white/50">
                  <span>Exc: {r.trench.trench_excavation_bcy.toFixed(1)} BCY</span>
                  <span>Bedding: {r.trench.bedding_material_cy.toFixed(1)} CY</span>
                  <span>Backfill: {r.trench.native_backfill_cy.toFixed(1)} CY</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="NN-NN-NN"
                    value={r.cost_code ?? ""}
                    onChange={(e) => updateUtilityCostCode(r.key, e.target.value)}
                    className={`flex-1 rounded border px-2 py-1 text-[11px] font-mono bg-black/40 focus:outline-none focus:border-[#CCFF00] ${
                      r.cost_code && !/^\d{2}-\d{2}-\d{2}$/.test(r.cost_code) ? "border-red-400/50" : "border-white/10"
                    }`}
                  />
                  {r.saved && <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Saved</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={saveAllUnsaved}
            disabled={saving || (shapes.every((s) => s.saved) && utilityRuns.every((r) => r.saved)) || (shapes.length === 0 && utilityRuns.length === 0)}
            className="w-full inline-flex h-11 items-center justify-center rounded-full bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save to Project Book"}
          </button>
          <p className="mt-2 text-center text-[10px] text-white/30">
            Cost codes must be <span className="font-mono">NN-NN-NN</span>. Rows without one save as uncoded.
          </p>
        </div>
      </aside>

      {utilityModalPts && (
        <UtilityRunModal
          previewLengthLf={totalLen(utilityModalPts) * scale}
          onCancel={() => { setUtilityModalPts(null); setUtilityDraftPts([]); }}
          onSubmit={commitUtilityRun}
        />
      )}
    </div>
  );
}

// ─── Utility Pipe Run input overlay ─────────────────────────────────────────
function UtilityRunModal({
  previewLengthLf, onCancel, onSubmit,
}: {
  previewLengthLf: number;
  onCancel: () => void;
  onSubmit: (inputs: UtilityRunInputs) => void;
}) {
  const [systemType, setSystemType] = useState<SystemType>("Sanitary Sewer");
  const [diameterIn, setDiameterIn] = useState(8);
  const [investStart, setInvertStart] = useState(0);
  const [invertEnd, setInvertEnd] = useState(0);
  const [trenchWidthFt, setTrenchWidthFt] = useState(3);

  const preview = useMemo(() => calcPipeEmbedment({
    length_lf: previewLengthLf,
    diameter_in: diameterIn,
    trench_width_ft: trenchWidthFt,
    avg_depth_ft: 4, // matches the server's DEFAULT_COVER_FT assumption
  }), [previewLengthLf, diameterIn, trenchWidthFt]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0E0F12] p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">Configure Pipe Run</h3>
          <button type="button" onClick={onCancel} className="text-white/40 hover:text-white">✕</button>
        </div>
        <p className="mb-4 text-[11px] text-white/50">
          Run length: <span className="font-mono text-[#a855f7]">{previewLengthLf.toFixed(1)} LF</span> (from the drawn polyline)
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">System Type</span>
            <select
              value={systemType}
              onChange={(e) => setSystemType(e.target.value as SystemType)}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]"
            >
              {SYSTEM_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Pipe Diameter (in)</span>
            <input type="number" min={1} step={1} value={diameterIn} onChange={(e) => setDiameterIn(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Trench Width (ft)</span>
            <input type="number" min={0.5} step={0.5} value={trenchWidthFt} onChange={(e) => setTrenchWidthFt(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Start Invert Elev. (ft)</span>
            <input type="number" step={0.01} value={investStart} onChange={(e) => setInvertStart(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">End Invert Elev. (ft)</span>
            <input type="number" step={0.01} value={invertEnd} onChange={(e) => setInvertEnd(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-white/70">
          <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Trench Excavation Yield</div>
          <div className="flex justify-between"><span>Total Trench Excavation</span><span className="font-mono">{preview.trench_excavation_bcy.toLocaleString()} BCY</span></div>
          <div className="flex justify-between"><span>Bedding Material</span><span className="font-mono">{preview.totals.aggregate_import_cy.toLocaleString()} CY</span></div>
          <div className="flex justify-between"><span>Native Backfill</span><span className="font-mono">{preview.common_backfill_cy.toLocaleString()} CY</span></div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white">Cancel</button>
          <button
            type="button"
            onClick={() => onSubmit({
              system_type: systemType,
              pipe_diameter_in: diameterIn,
              invert_elevation_start: investStart,
              invert_elevation_end: invertEnd,
              trench_width_ft: trenchWidthFt,
            })}
            className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85"
          >
            Add Pipe Run
          </button>
        </div>
      </div>
    </div>
  );
}
