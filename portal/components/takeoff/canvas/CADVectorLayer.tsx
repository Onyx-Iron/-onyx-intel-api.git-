"use client";

import { useEffect, useMemo, useState } from "react";
import { classifyLayer, type LayerClassification } from "@/lib/cad/layer-classify";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface RawVector {
  layer: string;
  type?: "polyline" | "bbox" | "point";
  points: Array<[number, number]>;   // world / drawing units
  text_tag?: string;
}

interface RenderedVector extends RawVector {
  key: string;
  classification: LayerClassification;
  measure: number;                   // LF / SF / EA
  screenPoints: Array<[number, number]>;  // canvas pixel coords
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Props {
  pageId: string;
  projectId: string;
  canvasSize: { w: number; h: number } | null;
  scaleRatio: number;                // real-units-per-canvas-pixel from sheet_calibrations
  onCommitted?: (m: {
    takeoff_type: "count" | "length" | "area";
    quantity: number;
    unit: "EA" | "LF" | "SF";
    cost_code?: string;
    description: string;
    geometry: unknown;
  }) => void;
  /** Called whenever the CAD vector set is (re)loaded — used by cross-verify. */
  onVectorsLoaded?: (descriptions: string[]) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function CADVectorLayer({ pageId, projectId, canvasSize, scaleRatio, onCommitted, onVectorsLoaded }: Props) {
  const [raw, setRaw] = useState<RawVector[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingPoints, setEditingPoints] = useState<Array<[number, number]> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<Set<string>>(new Set());

  // ── Load vectors (initial + on refresh signal from PDF extractor) ─────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/takeoff/canvas/vectors?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { vectors: RawVector[] };
        if (!cancelled && Array.isArray(data.vectors)) {
          setRaw(data.vectors);
          const descriptions = Array.from(new Set(data.vectors.map((v) => classifyLayer(v.layer).description)));
          onVectorsLoaded?.(descriptions);
        }
      } catch { /* silent */ }
    };
    void load();

    const onRefresh = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pageId?: string }>).detail;
      if (!detail?.pageId || detail.pageId === pageId) void load();
    };
    window.addEventListener("onyx:cad-vectors-refresh", onRefresh as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener("onyx:cad-vectors-refresh", onRefresh as EventListener);
    };
  }, [pageId]);

  // ── World→screen projection ───────────────────────────────────────────────
  // Fit-to-canvas: compute overall bbox in world units and scale to fit the
  // rendered PDF canvas. This works even when the CAD drawing's world origin
  // is far from the PDF's.
  const rendered: RenderedVector[] = useMemo(() => {
    if (!canvasSize || raw.length === 0) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of raw) {
      for (const [x, y] of v.points) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX)) return [];
    const wSpan = Math.max(1e-6, maxX - minX);
    const hSpan = Math.max(1e-6, maxY - minY);
    const pad = 20;
    const sx = (canvasSize.w - pad * 2) / wSpan;
    const sy = (canvasSize.h - pad * 2) / hSpan;
    const s  = Math.min(sx, sy);

    const project = (x: number, y: number): [number, number] => [
      pad + (x - minX) * s,
      canvasSize.h - pad - (y - minY) * s, // flip Y
    ];

    return raw.map((v, i) => {
      const cls = classifyLayer(v.layer);
      const screen = v.points.map(([x, y]) => project(x, y));
      let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
      for (const [x, y] of screen) {
        if (x < sMinX) sMinX = x; if (y < sMinY) sMinY = y;
        if (x > sMaxX) sMaxX = x; if (y > sMaxY) sMaxY = y;
      }
      // Compute measure using WORLD units for length/area, then apply scale if needed.
      // World units are trusted for CAD (usually feet). Scale only applied if the
      // page also has a pixel-calibration set (then screen distance × scale).
      let measure = 0;
      if (cls.takeoff_type === "count") {
        measure = 1;
      } else if (cls.takeoff_type === "length") {
        let sum = 0;
        for (let k = 1; k < v.points.length; k++) {
          const [ax, ay] = v.points[k - 1];
          const [bx, by] = v.points[k];
          sum += Math.hypot(bx - ax, by - ay);
        }
        measure = sum;
      } else {
        // area — shoelace on world coords
        let s2 = 0;
        for (let k = 0, n = v.points.length; k < n; k++) {
          const [ax, ay] = v.points[k];
          const [bx, by] = v.points[(k + 1) % n];
          s2 += ax * by - bx * ay;
        }
        measure = Math.abs(s2) / 2;
      }
      return {
        ...v,
        key: `${v.layer}-${i}`,
        classification: cls,
        measure: +measure.toFixed(2),
        screenPoints: screen,
        bbox: { minX: sMinX, minY: sMinY, maxX: sMaxX, maxY: sMaxY },
      };
    });
  }, [raw, canvasSize]);

  // ── Layer legend ──────────────────────────────────────────────────────────
  const layers = useMemo(() => {
    const map = new Map<string, { color: string; count: number; measure: number; unit: string }>();
    for (const v of rendered) {
      const key = v.layer;
      const e = map.get(key) ?? { color: v.classification.color, count: 0, measure: 0, unit: v.classification.unit };
      e.count += 1;
      e.measure += v.classification.takeoff_type === "count" ? 1 : v.measure;
      map.set(key, e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rendered]);

  const visible = useMemo(() => rendered.filter((v) => !layerFilter.has(v.layer)), [rendered, layerFilter]);
  const hover = useMemo(() => visible.find((v) => v.key === hoverKey) ?? null, [visible, hoverKey]);

  // ── Approve → persist as manual_takeoff ───────────────────────────────────
  async function approve(v: RenderedVector, override?: { points?: Array<[number, number]>; cost_code?: string; description?: string }) {
    setApproving(true);
    setStatus(null);
    try {
      const finalPoints = override?.points ?? v.points;
      // Re-measure if points overridden.
      let quantity = v.measure;
      if (override?.points) {
        if (v.classification.takeoff_type === "length") {
          let sum = 0;
          for (let k = 1; k < finalPoints.length; k++) sum += Math.hypot(finalPoints[k][0] - finalPoints[k-1][0], finalPoints[k][1] - finalPoints[k-1][1]);
          quantity = +sum.toFixed(2);
        } else if (v.classification.takeoff_type === "area") {
          let s = 0;
          for (let k = 0, n = finalPoints.length; k < n; k++) {
            const [ax, ay] = finalPoints[k];
            const [bx, by] = finalPoints[(k + 1) % n];
            s += ax * by - bx * ay;
          }
          quantity = +(Math.abs(s) / 2).toFixed(2);
        } else {
          quantity = 1;
        }
      }
      const item = {
        project_id: projectId,
        page_id: pageId,
        cost_code: override?.cost_code ?? v.classification.cost_code ?? null,
        takeoff_type: v.classification.takeoff_type,
        quantity,
        unit: v.classification.unit,
        geometry: {
          points: finalPoints.map(([x, y]) => ({ x, y })),
          layer: v.layer,
          text_tag: v.text_tag,
          source: "cad_vector",
          confidence: v.classification.confidence,
        },
      };
      const res = await fetch("/api/takeoff/canvas/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [item] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `save ${res.status}`);
      }
      onCommitted?.({
        takeoff_type: item.takeoff_type,
        quantity: item.quantity,
        unit: item.unit,
        cost_code: item.cost_code ?? undefined,
        description: override?.description ?? v.classification.description,
        geometry: item.geometry,
      });
      // Hide the approved vector so the user sees progress.
      setLayerFilter((prev) => new Set(prev).add(`__approved:${v.key}`));
      setRaw((prev) => prev.filter((_, i) => `${_.layer}-${i}` !== v.key));
      setHoverKey(null);
      setEditingKey(null);
      setEditingPoints(null);
      setStatus(`Added ${quantity.toFixed(1)} ${item.unit} → project`);
      setTimeout(() => setStatus(null), 2500);
    } catch (e) {
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setApproving(false);
    }
  }

  function reject(v: RenderedVector) {
    setRaw((prev) => prev.filter((_, i) => `${_.layer}-${i}` !== v.key));
    setHoverKey(null);
    setEditingKey(null);
    setEditingPoints(null);
  }

  function startEdit(v: RenderedVector) {
    setEditingKey(v.key);
    setEditingPoints(v.points.map((p) => [...p] as [number, number]));
  }

  // ── Render nothing if disabled or no vectors ──────────────────────────────
  if (!canvasSize) return null;

  return (
    <>
      {/* Vector SVG overlay */}
      {enabled && (
        <svg
          width={canvasSize.w}
          height={canvasSize.h}
          viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
          className="pointer-events-none absolute inset-0"
          style={{ mixBlendMode: "screen" }}
        >
          {visible.map((v) => {
            const isHov = v.key === hoverKey;
            const isEdit = v.key === editingKey;
            const pts = isEdit && editingPoints ? editingPoints.map((p) => [p[0], p[1]] as [number, number]) : v.screenPoints;
            const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ") + (v.classification.takeoff_type === "area" ? " Z" : "");
            const stroke = v.classification.color;
            return (
              <g key={v.key} style={{ pointerEvents: "auto" }}>
                <path
                  d={d}
                  stroke={stroke}
                  strokeWidth={isHov || isEdit ? 3 : 1.6}
                  opacity={isHov || isEdit ? 1 : 0.85}
                  fill={v.classification.takeoff_type === "area" ? `${stroke}22` : "none"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoverKey(v.key)}
                  onMouseLeave={() => setHoverKey((k) => (k === v.key ? null : k))}
                />
                {/* Bounding-box halo on hover */}
                {isHov && (
                  <rect
                    x={v.bbox.minX - 6} y={v.bbox.minY - 6}
                    width={v.bbox.maxX - v.bbox.minX + 12} height={v.bbox.maxY - v.bbox.minY + 12}
                    fill="none" stroke="#CCFF00" strokeWidth={1} strokeDasharray="4 3" opacity={0.6}
                  />
                )}
                {/* Vertex handles while editing */}
                {isEdit && editingPoints && v.screenPoints.map((sp, idx) => (
                  <circle
                    key={idx} cx={sp[0]} cy={sp[1]} r={4}
                    fill="#CCFF00" stroke="#000" strokeWidth={1}
                    style={{ cursor: "grab" }}
                    onMouseDown={(e) => {
                      const svg = (e.target as SVGElement).ownerSVGElement!;
                      const rect = svg.getBoundingClientRect();
                      const startWorld = v.points[idx];
                      const move = (ev: MouseEvent) => {
                        const dx = (ev.clientX - e.clientX) / (rect.width / canvasSize.w);
                        const dy = (ev.clientY - e.clientY) / (rect.height / canvasSize.h);
                        // Move in world coords proportionally (screen delta ÷ average axis scale).
                        // Rough but usable for user-friendly polygon reshaping.
                        setEditingPoints((prev) => {
                          if (!prev) return prev;
                          const next = prev.map((p) => [...p] as [number, number]);
                          next[idx] = [startWorld[0] + dx * scaleFactor(), startWorld[1] - dy * scaleFactor()];
                          return next;
                        });
                      };
                      const up = () => {
                        window.removeEventListener("mousemove", move);
                        window.removeEventListener("mouseup", up);
                      };
                      window.addEventListener("mousemove", move);
                      window.addEventListener("mouseup", up);
                    }}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      )}

      {/* Toolbar (top-right of canvas area) */}
      <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`inline-flex h-8 items-center rounded-full px-3 text-[10px] uppercase tracking-widest font-mono transition-colors ${
            enabled ? "bg-[#CCFF00] text-black" : "border border-white/15 bg-white/5 text-white/70 hover:text-white"
          }`}
        >
          CAD Vectors {enabled ? "on" : "off"}
        </button>
        {rendered.length > 0 && (
          <span className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[10px] uppercase tracking-widest font-mono text-white/50">
            {rendered.length} shapes · {layers.length} layers
          </span>
        )}
      </div>

      {/* Layer legend (bottom-right) */}
      {enabled && layers.length > 0 && (
        <div className="absolute bottom-4 right-4 z-30 max-h-[60vh] w-64 overflow-y-auto rounded-xl border border-white/10 bg-black/70 backdrop-blur">
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-mono text-white/40 border-b border-white/5">
            Layers
          </div>
          <div className="p-2 space-y-1">
            {layers.map(([name, meta]) => {
              const off = layerFilter.has(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setLayerFilter((prev) => {
                    const n = new Set(prev);
                    if (n.has(name)) n.delete(name); else n.add(name);
                    return n;
                  })}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    off ? "opacity-40" : "hover:bg-white/5"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="font-mono truncate">{name}</span>
                  <span className="ml-auto text-[10px] font-mono text-white/40">
                    {meta.count} · {meta.measure.toFixed(0)} {meta.unit}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Hover / edit card */}
      {enabled && hover && !editingKey && (
        <div
          className="absolute z-40 w-[320px] rounded-xl border border-white/15 bg-[#0E0F12] shadow-2xl"
          style={{
            left: Math.min(canvasSize.w - 340, Math.max(20, hover.bbox.maxX + 20)),
            top: Math.min(canvasSize.h - 260, Math.max(20, hover.bbox.minY)),
          }}
          onMouseEnter={() => setHoverKey(hover.key)}
        >
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">Detected</span>
              <span className={`text-[10px] uppercase tracking-widest font-mono ${confidenceTone(hover.classification.confidence)}`}>
                Match Confidence: {(hover.classification.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="mt-1 text-sm font-semibold">
              {formatDetected(hover)}
            </div>
            <div className="mt-1 text-[10px] font-mono text-white/40 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: hover.classification.color }} />
              <span className="truncate">{hover.layer}</span>
              {hover.text_tag && <><span>·</span><span className="truncate">{hover.text_tag}</span></>}
            </div>
          </div>
          <div className="p-3 text-xs text-white/70">
            Add to project estimate book?
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-white/10 p-3">
            <button
              type="button"
              onClick={() => reject(hover)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/70 hover:border-red-400/40 hover:text-red-400"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => startEdit(hover)}
              className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/85 hover:border-white/30 hover:text-white"
            >
              Modify
            </button>
            <button
              type="button"
              onClick={() => approve(hover)}
              disabled={approving}
              className="rounded-full bg-[#CCFF00] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40"
            >
              {approving ? "…" : "Approve"}
            </button>
          </div>
        </div>
      )}

      {/* Edit card */}
      {enabled && editingKey && (() => {
        const v = rendered.find((r) => r.key === editingKey);
        if (!v) return null;
        return (
          <div className="absolute right-4 top-16 z-40 w-[320px] rounded-xl border border-white/15 bg-[#0E0F12] shadow-2xl">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Editing vertices</div>
              <div className="mt-1 text-sm font-semibold">{v.layer}</div>
              <div className="mt-1 text-[10px] text-white/40">Drag the green handles on the drawing.</div>
            </div>
            <div className="grid grid-cols-3 gap-2 p-3">
              <button
                type="button"
                onClick={() => { setEditingKey(null); setEditingPoints(null); }}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/70"
              >
                Cancel
              </button>
              <div />
              <button
                type="button"
                onClick={() => approve(v, { points: editingPoints ?? v.points })}
                disabled={approving}
                className="rounded-full bg-[#CCFF00] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        );
      })()}

      {/* Bottom-left status */}
      {status && (
        <div className="absolute bottom-4 left-4 z-40 rounded-lg border border-white/10 bg-black/80 px-3 py-2 text-xs text-[#CCFF00] backdrop-blur">
          {status}
        </div>
      )}
    </>
  );

  function scaleFactor() {
    // world_units_per_screen_pixel for vertex-drag inverse projection.
    // Rough estimate — canvas is already fit-to-content; using scaleRatio
    // as an override when calibrated.
    return scaleRatio > 0 && scaleRatio < 100 ? scaleRatio : 1;
  }
}

function confidenceTone(c: number): string {
  if (c >= 0.85) return "text-[#CCFF00]";
  if (c >= 0.65) return "text-amber-400";
  return "text-white/50";
}

function formatDetected(v: RenderedVector): string {
  const q = v.measure;
  const u = v.classification.unit;
  const d = v.classification.description;
  const qStr = q >= 100 ? Math.round(q).toLocaleString() : q.toFixed(1);
  if (v.classification.takeoff_type === "count") return `${qStr} ${u} of ${d}`;
  return `${qStr} ${u} of ${d}`;
}
