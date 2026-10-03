"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CADVectorLayer from "./CADVectorLayer";
import VisionExtractionsPanel from "./VisionExtractionsPanel";
import { extractVectorsFromPdfPage } from "@/lib/cad/pdf-vector-page";
import { calcPipeEmbedment, trenchPrism } from "@/lib/math/civil-scope";
import { applySheetTransform, fitSheetTransform, type SheetTransform } from "@/lib/cad/georeference";
import { bufferCenterline } from "@/lib/takeoff/canvas/centerline";
import { netArea } from "@/lib/takeoff/canvas/net-area";
import { topoToSurfacePoints } from "@/lib/takeoff/canvas/topo-surface";
import { pointsToPageSpace, pointsToScreenSpace, samePoints, toPageSpace, translateStoredPoints, translateStoredRings } from "@/lib/takeoff/canvas/coordinates";
import { cachedPdfDocument } from "@/lib/takeoff/canvas/pdf-cache";
import { rasterizePdfOffThread } from "@/lib/takeoff/canvas/pdf-raster";
import { matchingSheetBitmap, rememberSheetBitmap, sheetRenderScale } from "@/lib/takeoff/canvas/sheet-bitmap-cache";
import { buildSnapIndex, nearestSnap } from "@/lib/takeoff/canvas/snap-index";
import { triangleFillPath } from "@/lib/takeoff/canvas/tessellate";
import { markPageVectorScanDone, pageVectorScanDone } from "@/lib/takeoff/canvas/vector-scan-cache";
import { useConfirm } from "@/components/common/ConfirmDialog";

// Coordinate-space tag carried alongside each committed item (professional-
// manual-takeoff milestone, PERMANENT RULE 1/2). 'page_space' points are
// stable regardless of window size/zoom — see lib/takeoff/canvas/
// coordinates.ts for why this matters: the previous version of this file
// stored every drawn point in CURRENT-RENDER canvas-pixel coordinates,
// which vary with window width, so reopening the same sheet in a
// differently-sized window would render saved geometry in the wrong
// location. Items saved before this milestone have no tag (undefined) and
// are treated as 'legacy_pixel' — rendered exactly as before, never
// reinterpreted, so existing takeoff data renders identically to how it
// always has (RULE 15/17: preserve existing data, never fabricate).
type CoordinateSpace = "page_space" | "legacy_pixel";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Tool = "pan" | "calibrate" | "count" | "length" | "area" | "symbol" | "utility_pipe" | "spot_elevation" | "contour_line" | "civil_area_bounds";

interface Pt { x: number; y: number }

interface Shape {
  key: string;                // client-side id
  id?: string;                // server id once saved — required to PATCH an existing object
  row_version?: number;       // optimistic-concurrency version last read from the server (see update_manual_takeoff_tx)
  tool: "count" | "length" | "area";
  points: Pt[];               // coords in `coordinateSpace` (see toDisplayPoints)
  holes?: Pt[][];             // area openings (shaft, stair) in the same coordinate space
  coordinateSpace: CoordinateSpace;
  quantity: number;           // computed (count: N; length: LF; area: SF)
  unit: "EA" | "LF" | "SF";
  cost_code?: string;
  label?: string;
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
  points: Pt[];                // coords in `coordinateSpace`
  coordinateSpace: CoordinateSpace;
  run_length_lf: number;
  inputs: UtilityRunInputs;
  trench: TrenchYield;
  cost_code?: string;
  saved?: boolean;
}

// Page-space calibration model (manual-takeoff-calibration-hardening
// milestone). `scale_ratio` is the OLD render-pixel-relative field, kept
// only so a legacy row (created before this milestone) still renders/scales
// using its original (render-scale-dependent) behavior — see the `scale`
// useMemo below and LEGACY_MIGRATION_POLICY.md. `page_space_scale_factor` is
// the new authoritative value: real-world units per PAGE-SPACE unit,
// invariant to render scale/zoom/window size entirely.
interface Calibration {
  scale_ratio: number | null; // legacy: real-units per canvas pixel AT CALIBRATION TIME (render-scale-dependent — do not use for new calculations)
  unit_type: string;          // "LF"
  page_space_scale_factor: number | null; // real-units per page-space-unit — render-scale-independent
  status: "legacy_render_space" | "migrated" | "verified" | "needs_verification";
  verified: boolean;
}

// ── Topographic contour / spot elevation nodes ──
interface TopoNode {
  key: string;
  id?: string;
  node_type: "contour_line" | "spot_elevation";
  points: Pt[];               // coords in `coordinateSpace`
  coordinateSpace: CoordinateSpace;
  elevation: number;
  layer_assignment?: string;  // "manual" or the matched CAD layer, e.g. "C-TOPO"
  saved?: boolean;
}

// ── Area Bounds takeoff (site clearing / stripping / paving / flatwork) ──
const AREA_BOUNDARY_KINDS = [
  { value: "topsoil_stripping", label: "Topsoil Stripping Limits" },
  { value: "building_pad",      label: "Building Pad Subgrade / Over-Excavation Limits" },
  { value: "asphalt_paving",    label: "Asphalt Paving Limits" },
  { value: "concrete_flatwork", label: "Concrete Sidewalk & Flatwork Bounds" },
] as const;
type BoundaryKind = typeof AREA_BOUNDARY_KINDS[number]["value"];
const DEPTH_APPLICABLE_KINDS: ReadonlySet<BoundaryKind> = new Set(["topsoil_stripping", "building_pad"]);

interface AreaBound {
  key: string;
  id?: string;
  points: Pt[];                // coords in `coordinateSpace`
  coordinateSpace: CoordinateSpace;
  boundary_kind: BoundaryKind;
  area_sf: number;
  depth_in?: number;
  volume_cy?: number;
  target_cost_code?: string;
  saved?: boolean;
}

interface Props {
  projectId: string;
  projectName: string;
  pageId: string;
  pageNumber: number;
  documentId: string;
}

function displayPoints(points: Pt[], coordinateSpace: CoordinateSpace, renderScale: number): Pt[] {
  return coordinateSpace === "page_space" ? pointsToScreenSpace(points, renderScale) : points;
}

const ShapeGlyph = memo(function ShapeGlyph({
  shape,
  selected,
  renderScale,
  canDrag,
  onSelect,
  onDragStart,
}: {
  shape: Shape;
  selected: boolean;
  renderScale: number;
  canDrag: boolean;
  onSelect: (key: string) => void;
  onDragStart: (event: React.MouseEvent, shape: Shape) => void;
}) {
  const color = shape.tool === "count" ? "#CCFF00" : shape.tool === "length" ? "#00D2FF" : "#f97316";
  const pts = displayPoints(shape.points, shape.coordinateSpace, renderScale);
  const cursorClass = canDrag && shape.saved && shape.id ? "cursor-move" : "";
  const onMouseDown = (event: React.MouseEvent) => onDragStart(event, shape);
  const onClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onSelect(shape.key);
  };

  if (shape.tool === "count") {
    const p = pts[0];
    if (!p) return null;
    return (
      <g className={cursorClass} onClick={onClick} onMouseDown={onMouseDown}>
        <circle cx={p.x} cy={p.y} r={selected ? 9 : 7} fill={color} stroke="#000" strokeWidth={2} />
      </g>
    );
  }

  const close = shape.tool === "area" ? " Z" : "";
  const holePaths = (shape.holes ?? []).map((ring) => {
    const projected = displayPoints(ring, shape.coordinateSpace, renderScale);
    return projected.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
  }).join(" ");
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + close;
  if (shape.tool === "length") {
    return (
      <g className={cursorClass} onClick={onClick} onMouseDown={onMouseDown}>
        <path d={d} stroke={color} strokeWidth={selected ? 4 : 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  return (
    <g className={cursorClass} onClick={onClick} onMouseDown={onMouseDown}>
      <path d={triangleFillPath(pts)} fill={`${color}44`} stroke="none" />
      {holePaths && <path d={holePaths} fill="#06070A" fillOpacity={0.7} stroke={color} strokeWidth={1} />}
      <path d={d} fill="none" stroke={color} strokeWidth={selected ? 3 : 2} />
    </g>
  );
});

/** Saved sheet geometry. Draft points live outside this memo so drawing does not rebuild every path. */
const SavedMarkup = memo(function SavedMarkup({
  shapes,
  utilityRuns,
  topoNodes,
  areaBounds,
  selectedKey,
  renderScale,
  canDrag,
  onSelect,
  onDragStart,
}: {
  shapes: Shape[];
  utilityRuns: UtilityRun[];
  topoNodes: TopoNode[];
  areaBounds: AreaBound[];
  selectedKey: string | null;
  renderScale: number;
  canDrag: boolean;
  onSelect: (key: string) => void;
  onDragStart: (event: React.MouseEvent, shape: Shape) => void;
}) {
  return (
    <>
      {shapes.map((shape) => (
        <ShapeGlyph
          key={shape.key}
          shape={shape}
          selected={shape.key === selectedKey}
          renderScale={renderScale}
          canDrag={canDrag}
          onSelect={onSelect}
          onDragStart={onDragStart}
        />
      ))}
      {utilityRuns.map((run) => {
        const pts = displayPoints(run.points, run.coordinateSpace, renderScale);
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        return (
          <g key={run.key}>
            <path d={d} stroke="#a855f7" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 4" />
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#a855f7" stroke="#000" strokeWidth={1} />
            ))}
          </g>
        );
      })}
      {topoNodes.map((node) => {
        const pts = displayPoints(node.points, node.coordinateSpace, renderScale);
        if (node.node_type === "spot_elevation") {
          const p = pts[0];
          if (!p) return null;
          return (
            <g key={node.key}>
              <line x1={p.x - 7} y1={p.y} x2={p.x + 7} y2={p.y} stroke="#22d3ee" strokeWidth={2} />
              <line x1={p.x} y1={p.y - 7} x2={p.x} y2={p.y + 7} stroke="#22d3ee" strokeWidth={2} />
              <circle cx={p.x} cy={p.y} r={2} fill="#22d3ee" />
              <text x={p.x + 10} y={p.y - 8} fontSize={11} fill="#22d3ee" fontFamily="monospace">{node.elevation.toFixed(2)}&apos;</text>
            </g>
          );
        }
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        const mid = pts[Math.floor(pts.length / 2)];
        return (
          <g key={node.key}>
            <path d={d} stroke="#22d3ee" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {mid && <text x={mid.x + 6} y={mid.y - 6} fontSize={11} fill="#22d3ee" fontFamily="monospace">{node.elevation.toFixed(2)}&apos;</text>}
          </g>
        );
      })}
      {areaBounds.map((bound) => {
        const pts = displayPoints(bound.points, bound.coordinateSpace, renderScale);
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
        return (
          <g key={bound.key}>
            <path d={triangleFillPath(pts)} fill="#f9731633" stroke="none" />
            <path d={d} fill="none" stroke="#f97316" strokeWidth={2} />
          </g>
        );
      })}
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function SheetCanvas({ projectId, projectName, pageId, pageNumber }: Props) {
  const { confirm } = useConfirm();
  const wrapRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfUrl, setPdfUrl]         = useState<string | null>(null);
  const [renderSize, setRenderSize] = useState<{ w: number; h: number } | null>(null);
  // The pdf.js viewport scale actually used for the CURRENT render — distinct
  // from `calibration.scale_ratio` (real-world-units-per-pixel). This is what
  // varies with window width; page-space geometry is this render's pixel
  // coordinates divided by this value (see lib/takeoff/canvas/coordinates.ts).
  const [renderScale, setRenderScale] = useState<number>(1);
  // Render-time projection: page_space items are stored viewport-independent
  // and must be projected through the CURRENT renderScale to draw at the
  // right screen pixels; legacy_pixel items are already in this render's
  // pixel space (their old, viewport-dependent behavior — unchanged) so they
  // pass through untouched.
  const toDisplayPoints = useCallback((points: Pt[], coordinateSpace: CoordinateSpace): Pt[] => {
    return coordinateSpace === "page_space" ? pointsToScreenSpace(points, renderScale) : points;
  }, [renderScale]);
  const [tool, setTool]             = useState<Tool>("pan");
  const [shapes, setShapes]         = useState<Shape[]>([]);
  const [draftPoints, setDraftPoints] = useState<Pt[]>([]);   // in-progress polygon/line points
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibPts, setCalibPts]     = useState<Pt[]>([]);     // during calibrate mode
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Whole-object drag state for an already-SAVED Shape (count/length/area) —
  // manual-takeoff-productivity milestone, STEP 4/2 (core geometry editing +
  // optimistic concurrency). Vertex-level editing, and dragging for utility
  // runs/topo nodes/area bounds, is deferred — see REMAINING_RISKS.md.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const commitShapeDragRef = useRef<(drag: { key: string; originalPoints: Pt[]; originalHoles?: Pt[][]; originalRowVersion: number }, finalPoints: Pt[], finalHoles?: Pt[][]) => Promise<void>>(async () => {});
  const [deletedTakeoffs, setDeletedTakeoffs] = useState<Array<{ id: string; quantity: number; unit: string | null; takeoff_type: string }>>([]);
  const [vectorDescriptions, setVectorDescriptions] = useState<string[]>([]);
  const [utilityRuns, setUtilityRuns] = useState<UtilityRun[]>([]);
  const [utilityDraftPts, setUtilityDraftPts] = useState<Pt[]>([]);
  const [utilityModalPts, setUtilityModalPts] = useState<Pt[] | null>(null); // non-null while the input overlay is open

  // Topo (contour / spot elevation)
  const [topoNodes, setTopoNodes] = useState<TopoNode[]>([]);
  const [contourDraftPts, setContourDraftPts] = useState<Pt[]>([]);
  const [autoTopoMatching, setAutoTopoMatching] = useState(false);
  const [autoTopoStatus, setAutoTopoStatus] = useState<string | null>(null);

  // Area Bounds
  const [areaBounds, setAreaBounds] = useState<AreaBound[]>([]);
  const [areaDraftPts, setAreaDraftPts] = useState<Pt[]>([]);
  const [areaBoundaryKind, setAreaBoundaryKind] = useState<BoundaryKind>("topsoil_stripping");
  const [areaDepthIn, setAreaDepthIn] = useState(6);
  const [cadSnapPoints, setCadSnapPoints] = useState<Pt[]>([]);
  const [areaHoles, setAreaHoles] = useState<Pt[][]>([]);
  const [holeDraft, setHoleDraft] = useState<Pt[] | null>(null);
  const [wallWidthFt, setWallWidthFt] = useState("");
  const [symbolPts, setSymbolPts] = useState<Pt[]>([]);
  const [symbolBusy, setSymbolBusy] = useState(false);
  const [surveyEpsg, setSurveyEpsg] = useState(2276);
  const [tieA, setTieA] = useState({ e: "", n: "" });
  const [tieB, setTieB] = useState({ e: "", n: "" });
  const [sheetTie, setSheetTie] = useState<SheetTransform | null>(null);
  const [publishingGrade, setPublishingGrade] = useState(false);
  const onCadScreenPoints = useCallback((points: Pt[]) => {
    setCadSnapPoints(points);
  }, []);

  // ── Load signed URL + existing calibration + saved takeoffs ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sheetRes = await fetch(`/api/takeoff/canvas/sheet?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" });
        if (!sheetRes.ok) throw new Error(`sheet ${sheetRes.status}`);
        const sheet = await sheetRes.json() as {
          url: string;
          calibration: Calibration | null;
          manual: { items: Array<{ id: string; deleted_at?: string | null; takeoff_type: "count" | "length" | "area"; cost_code: string | null; quantity: number; unit: string | null; row_version?: number; geometry: { points?: Pt[]; holes?: Pt[][]; description?: string; coordinate_space?: string } }> };
          utility: { items: Array<{
            id: string; system_type: string; pipe_diameter_in: number;
            invert_elevation_start: number | null; invert_elevation_end: number | null;
            trench_width_ft: number; run_length_lf: number;
            cost_code: string | null; geometry: { points?: Pt[]; coordinate_space?: string } | null;
            computed_trench_json: { trench_excavation_bcy?: number; common_backfill_cy?: number; totals?: { aggregate_import_cy?: number } } | null;
          }> };
          topo: { items: Array<{ id: string; node_type: "contour_line" | "spot_elevation"; elevation: number; layer_assignment: string | null; geometry: { points?: Pt[]; coordinate_space?: string } | null }> };
          area_bounds: { items: Array<{
            id: string; boundary_kind: BoundaryKind; area_sf: number; stripping_depth_in: number | null;
            excavation_volume_cy: number | null; target_cost_code: string | null; boundary_geometry: { points?: Pt[]; coordinate_space?: string } | null;
          }> };
        };
        if (!cancelled) setPdfUrl(sheet.url);
        if (!cancelled) setCalibration(sheet.calibration);

        {
          const mtData = sheet.manual;
          if (!cancelled) {
            setDeletedTakeoffs(mtData.items.filter((it) => it.deleted_at).map((it) => ({ id: it.id, quantity: it.quantity, unit: it.unit, takeoff_type: it.takeoff_type })));
            setShapes(mtData.items.filter((it) => !it.deleted_at).map((it) => ({
              key: `saved-${it.id}`,
              id: it.id,
              row_version: it.row_version ?? 1,
              tool: it.takeoff_type,
              points: Array.isArray(it.geometry?.points) ? it.geometry.points : [],
              holes: Array.isArray(it.geometry?.holes) ? it.geometry.holes : undefined,
              label: typeof it.geometry?.description === "string" ? it.geometry.description : undefined,
              // Absent/unrecognized tag → 'legacy_pixel' (rows saved before
              // this milestone) — never assumed to be page_space, so old
              // geometry keeps rendering exactly as it always has.
              coordinateSpace: (it.geometry?.coordinate_space === "page_space" ? "page_space" : "legacy_pixel") as CoordinateSpace,
              quantity: Number(it.quantity),
              unit: (it.unit ?? (it.takeoff_type === "count" ? "EA" : it.takeoff_type === "length" ? "LF" : "SF")) as Shape["unit"],
              cost_code: it.cost_code ?? undefined,
              saved: true,
            })).filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)); // dedupe by key
          }
        }
        {
          const utData = sheet.utility;
          if (!cancelled) {
            setUtilityRuns(utData.items.map((it) => ({
              key: `saved-${it.id}`,
              id: it.id,
              points: Array.isArray(it.geometry?.points) ? it.geometry!.points! : [],
              coordinateSpace: (it.geometry?.coordinate_space === "page_space" ? "page_space" : "legacy_pixel") as CoordinateSpace,
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
        {
          const topoData = sheet.topo;
          if (!cancelled) {
            setTopoNodes(topoData.items.map((it) => ({
              key: `saved-${it.id}`, id: it.id, node_type: it.node_type,
              points: Array.isArray(it.geometry?.points) ? it.geometry!.points! : [],
              coordinateSpace: (it.geometry?.coordinate_space === "page_space" ? "page_space" : "legacy_pixel") as CoordinateSpace,
              elevation: Number(it.elevation),
              layer_assignment: it.layer_assignment ?? undefined,
              saved: true,
            })));
          }
        }
        {
          const areaData = sheet.area_bounds;
          if (!cancelled) {
            setAreaBounds(areaData.items.map((it) => ({
              key: `saved-${it.id}`, id: it.id,
              points: Array.isArray(it.boundary_geometry?.points) ? it.boundary_geometry!.points! : [],
              coordinateSpace: (it.boundary_geometry?.coordinate_space === "page_space" ? "page_space" : "legacy_pixel") as CoordinateSpace,
              boundary_kind: it.boundary_kind,
              area_sf: Number(it.area_sf),
              depth_in: it.stripping_depth_in != null ? Number(it.stripping_depth_in) : undefined,
              volume_cy: it.excavation_volume_cy != null ? Number(it.excavation_volume_cy) : undefined,
              target_cost_code: it.target_cost_code ?? undefined,
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
    let idleId: number | null = null;
    let timeoutId: number | null = null;
    let cleaned = false;
    (async () => {
      try {
        const containerWidth = wrapRef.current?.clientWidth ?? 1200;
        const cached = matchingSheetBitmap<ImageBitmap>(pageId, containerWidth);
        const cvs = canvasRef.current;
        if (!cvs || cancelled) return;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;
        if (cached) {
          cvs.width = cached.bitmap.width;
          cvs.height = cached.bitmap.height;
          ctx.drawImage(cached.bitmap, 0, 0);
          if (!cancelled) {
            setRenderSize({ w: cached.bitmap.width, h: cached.bitmap.height });
            setRenderScale(cached.scale);
          }
          if (pageVectorScanDone(pageId)) return;
        }

        const pdfjs = await import("pdfjs-dist");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await cachedPdfDocument(pdfUrl, () => pdfjs.getDocument({ url: pdfUrl }).promise);
        // Split plan sets store one sheet per file. Always paint page 1 of that file.
        const page = await doc.getPage(1);

        const viewport1 = page.getViewport({ scale: 1 });
        const scale = sheetRenderScale(containerWidth, viewport1.width);
        if (!cached) {
          const viewport = page.getViewport({ scale });
          let paintedOffThread = false;
          try {
            const raster = await rasterizePdfOffThread(pdfUrl, containerWidth);
            if (!cancelled) {
              cvs.width = raster.width;
              cvs.height = raster.height;
              ctx.drawImage(raster.bitmap, 0, 0);
              setRenderSize({ w: raster.width, h: raster.height });
              setRenderScale(raster.scale);
              if (typeof createImageBitmap === "function") {
                const bitmap = await createImageBitmap(cvs);
                rememberSheetBitmap(pageId, {
                  pageWidth: raster.pageWidth,
                  pageHeight: raster.pageHeight,
                  scale: raster.scale,
                  bitmap,
                });
              }
              raster.bitmap.close?.();
              paintedOffThread = true;
            }
          } catch (rasterErr) {
            console.warn("[SheetCanvas] offscreen PDF raster failed; painting on the main thread", rasterErr);
          }
          if (!paintedOffThread && !cancelled) {
            cvs.width = viewport.width;
            cvs.height = viewport.height;
            await page.render({ canvas: cvs, canvasContext: ctx, viewport }).promise;
            if (!cancelled) {
              setRenderSize({ w: viewport.width, h: viewport.height });
              setRenderScale(scale);
            }
            if (typeof createImageBitmap === "function") {
              const bitmap = await createImageBitmap(cvs);
              rememberSheetBitmap(pageId, { pageWidth: viewport1.width, pageHeight: viewport1.height, scale, bitmap });
            }
          }
        }

        // Vector extraction walks the whole operator list. The sheet is
        // already painted, and a page scanned earlier this session does not
        // need another GET or another walk.
        if (!cancelled && !pageVectorScanDone(pageId)) {
          const extractVectors = async () => {
            if (cancelled || pageVectorScanDone(pageId)) return;
            try {
              const check = await fetch(
                `/api/takeoff/canvas/vectors?page_id=${encodeURIComponent(pageId)}`,
                { cache: "no-store" },
              );
              const existing = check.ok ? (await check.json() as { vectors?: unknown[] }) : { vectors: [] };
              if ((existing.vectors ?? []).length > 0) {
                markPageVectorScanDone(pageId);
                return;
              }
              const vectors = await extractVectorsFromPdfPage(page);
              if (cancelled) return;
              if (vectors.length === 0) {
                markPageVectorScanDone(pageId);
                return;
              }
              const saved = await fetch("/api/takeoff/canvas/vectors", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ page_id: pageId, vectors }),
              });
              if (!saved.ok || cancelled) return;
              markPageVectorScanDone(pageId);
              window.setTimeout(() => window.dispatchEvent(new CustomEvent("onyx:cad-vectors-refresh", { detail: { pageId } })), 300);
            } catch (extractErr) {
              console.warn("[SheetCanvas] PDF vector extraction skipped:", extractErr);
            }
          };
          if (typeof window.requestIdleCallback === "function") {
            idleId = window.requestIdleCallback(() => { void extractVectors(); });
            if (cleaned) window.cancelIdleCallback(idleId);
          } else {
            timeoutId = window.setTimeout(() => { void extractVectors(); }, 1);
            if (cleaned) window.clearTimeout(timeoutId);
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      cleaned = true;
      if (idleId != null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
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
  // `scale` is real-world-units per CURRENT-RENDER pixel — every existing
  // `pixelDistance(...) * scale` / `polygonArea(...) * scale * scale` call
  // site below is left untouched; this derivation is what makes them
  // correct at any render scale. For a page-space-calibrated sheet,
  // page_space_scale_factor (real-units per PAGE-SPACE unit, fixed
  // regardless of window size) is divided by the CURRENT renderScale to
  // yield the correct per-CURRENT-pixel value dynamically — so resizing the
  // window or reopening in a different-sized window automatically keeps
  // every quantity calculation correct without touching the formulas
  // themselves. A legacy (render-pixel) calibration falls back to its
  // original render-scale-dependent scale_ratio unchanged (STEP 4 — never
  // fabricate a page-space factor for a calibration that predates one).
  const scale = useMemo(() => {
    if (calibration?.page_space_scale_factor != null && renderScale > 0) {
      return calibration.page_space_scale_factor / renderScale;
    }
    return calibration?.scale_ratio ?? 1;
  }, [calibration, renderScale]);
  const pixelDistance = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const totalLen = (pts: Pt[]) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += pixelDistance(pts[i - 1], pts[i]);
    return s;
  };
  const [snapCursor, setSnapCursor] = useState<Pt | null>(null);
  const snapIndex = useMemo(() => {
    const points: Pt[] = [];
    for (const shape of shapes) points.push(...displayPoints(shape.points, shape.coordinateSpace, renderScale));
    for (const run of utilityRuns) points.push(...displayPoints(run.points, run.coordinateSpace, renderScale));
    for (const node of topoNodes) points.push(...displayPoints(node.points, node.coordinateSpace, renderScale));
    for (const bound of areaBounds) points.push(...displayPoints(bound.points, bound.coordinateSpace, renderScale));
    points.push(...cadSnapPoints);
    return buildSnapIndex(points);
  }, [shapes, utilityRuns, topoNodes, areaBounds, cadSnapPoints, renderScale]);
  const snapDrawingPoint = useCallback((point: Pt): Pt => {
    if (tool === "pan") return point;
    return nearestSnap(snapIndex, point.x, point.y, 12) ?? point;
  }, [snapIndex, tool]);

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
    if (tool === "area") {
      const holes = holeDraft && holeDraft.length >= 3 ? [...areaHoles, holeDraft] : areaHoles;
      return netArea(draftPoints, holes) * scale * scale;
    }
    return 0;
  }, [draftPoints, tool, scale, areaHoles, holeDraft]);

  // ── Click handling ────────────────────────────────────────────────────────
  const onCanvasClick: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!renderSize) return;
    const p = snapDrawingPoint(toLocal(e.clientX, e.clientY, e.currentTarget));

    if (tool === "calibrate") {
      const next = [...calibPts, p];
      if (next.length === 2) {
        const eastA = Number(tieA.e);
        const northA = Number(tieA.n);
        const eastB = Number(tieB.e);
        const northB = Number(tieB.n);
        const tied = [eastA, northA, eastB, northB].every((value) => Number.isFinite(value));
        const worldDistance = tied ? Math.hypot(eastB - eastA, northB - northA) : 0;
        let feet = worldDistance;
        if (!(feet > 0)) {
          const raw = window.prompt("Enter the real-world distance between the two clicks (feet):", "10");
          feet = raw == null ? NaN : Number(raw);
        }
        if (Number.isFinite(feet) && feet > 0) {
          const px = pixelDistance(next[0], next[1]);
          // Convert the two CURRENT-render-pixel click points to page
          // space before sending — the server computes and stores
          // page_space_scale_factor from these page-space points itself,
          // never from a render-pixel ratio (STEP 2: never fabricate
          // calibration from current_render_pixels * historical scale).
          if (px > 0) saveCalibration(toPageSpace(next[0], renderScale), toPageSpace(next[1], renderScale), feet);
        }
        if (tied && worldDistance > 0) {
          try {
            const transform = fitSheetTransform(next[0], next[1], { x: eastA, y: northA }, { x: eastB, y: northB }, surveyEpsg);
            setSheetTie(transform);
          } catch {
            setSheetTie(null);
          }
        }
        setCalibPts([]);
        setTool("pan");
      } else {
        setCalibPts(next);
      }
      return;
    }

    if (tool === "symbol") {
      const next = [...symbolPts, p];
      if (next.length === 2) {
        setSymbolPts([]);
        void countSymbolCrop(next[0], next[1]);
      } else {
        setSymbolPts(next);
      }
      return;
    }

    if (tool === "count") {
      const shape: Shape = {
        // eslint-disable-next-line react-hooks/purity
        key: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tool: "count",
        points: [p],
        // Freshly drawn this session — already in the CURRENT render's pixel
        // space, so it renders directly with no page-space conversion until
        // saveAllUnsaved converts it for persistence.
        coordinateSpace: "legacy_pixel",
        quantity: 1,
        unit: "EA",
      };
      setShapes((prev) => [...prev, shape]);
      return;
    }

    if (tool === "length" || tool === "area") {
      if (tool === "area" && holeDraft) setHoleDraft((prev) => [...(prev ?? []), p]);
      else setDraftPoints((prev) => [...prev, p]);
    }

    if (tool === "utility_pipe") {
      setUtilityDraftPts((prev) => [...prev, p]);
    }

    if (tool === "spot_elevation") {
      const raw = window.prompt("Enter the true elevation at this point (feet), e.g. 412.55:", "");
      if (raw != null) {
        const elevation = Number(raw);
        if (Number.isFinite(elevation)) {
          setTopoNodes((prev) => [...prev, {
            key: `spot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            node_type: "spot_elevation",
            points: [p],
            coordinateSpace: "legacy_pixel",
            elevation,
            layer_assignment: "manual",
          }]);
        }
      }
      return;
    }

    if (tool === "contour_line") {
      setContourDraftPts((prev) => [...prev, p]);
    }

    if (tool === "civil_area_bounds") {
      setAreaDraftPts((prev) => [...prev, p]);
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
      coordinateSpace: "legacy_pixel",
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

  const finishContourDraft = useCallback(() => {
    if (contourDraftPts.length < 2) { setContourDraftPts([]); return; }
    const raw = window.prompt("Enter this contour's baseline elevation (feet), e.g. 410.00:", "");
    if (raw != null) {
      const elevation = Number(raw);
      if (Number.isFinite(elevation)) {
        setTopoNodes((prev) => [...prev, {
          key: `contour-${Date.now()}`,
          node_type: "contour_line",
          points: contourDraftPts,
          coordinateSpace: "legacy_pixel",
          elevation,
          layer_assignment: "manual",
        }]);
      }
    }
    setContourDraftPts([]);
  }, [contourDraftPts]);

  // Live SF (shoelace × scale²) and, for stripping/pad kinds, CY preview while drawing.
  const areaDraftPreview = useMemo(() => {
    if (areaDraftPts.length < 3) return { sf: 0, cy: null as number | null };
    const sf = polygonArea(areaDraftPts) * scale * scale;
    const cy = DEPTH_APPLICABLE_KINDS.has(areaBoundaryKind) ? (sf * (areaDepthIn / 12)) / 27 : null;
    return { sf, cy };
  }, [areaDraftPts, scale, areaBoundaryKind, areaDepthIn]);

  const finishAreaBoundsDraft = useCallback(() => {
    if (areaDraftPts.length < 3) { setAreaDraftPts([]); return; }
    const sf = polygonArea(areaDraftPts) * scale * scale;
    const cy = DEPTH_APPLICABLE_KINDS.has(areaBoundaryKind) ? (sf * (areaDepthIn / 12)) / 27 : undefined;
    setAreaBounds((prev) => [...prev, {
      key: `area-${Date.now()}`,
      points: areaDraftPts,
      coordinateSpace: "legacy_pixel",
      boundary_kind: areaBoundaryKind,
      area_sf: sf,
      depth_in: DEPTH_APPLICABLE_KINDS.has(areaBoundaryKind) ? areaDepthIn : undefined,
      volume_cy: cy,
    }]);
    setAreaDraftPts([]);
  }, [areaDraftPts, scale, areaBoundaryKind, areaDepthIn]);

  const finishDraft = useCallback(() => {
    if (tool === "utility_pipe") { finishUtilityDraft(); return; }
    if (tool === "contour_line") { finishContourDraft(); return; }
    if (tool === "civil_area_bounds") { finishAreaBoundsDraft(); return; }
    if (holeDraft) {
      if (holeDraft.length >= 3) setAreaHoles((prev) => [...prev, holeDraft]);
      setHoleDraft(null);
      return;
    }
    if (draftPoints.length < 2) { setDraftPoints([]); setHoleDraft(null); return; }
    if (tool === "length") {
      const quantity = totalLen(draftPoints) * scale;
      const width = Number(wallWidthFt);
      const created: Shape[] = [{
        key: `l-${Date.now()}`,
        tool: "length",
        points: draftPoints,
        coordinateSpace: "legacy_pixel",
        quantity,
        unit: "LF",
      }];
      if (Number.isFinite(width) && width > 0 && scale > 0) {
        const buffered = bufferCenterline(draftPoints, (width / 2) / scale);
        if (buffered.ring.length >= 3) {
          created.push({
            key: `pave-${Date.now()}`,
            tool: "area",
            points: buffered.ring,
            coordinateSpace: "legacy_pixel",
            quantity: buffered.area * scale * scale,
            unit: "SF",
            label: "Centerline offset",
          });
        }
      }
      setShapes((prev) => [...prev, ...created]);
    } else if (tool === "area" && draftPoints.length >= 3) {
      const quantity = netArea(draftPoints, areaHoles) * scale * scale;
      setShapes((prev) => [...prev, {
        key: `a-${Date.now()}`,
        tool: "area",
        points: draftPoints,
        holes: areaHoles.length > 0 ? areaHoles : undefined,
        coordinateSpace: "legacy_pixel",
        quantity,
        unit: "SF",
      }]);
      setAreaHoles([]);
      setHoleDraft(null);
    }
    setDraftPoints([]);
  }, [draftPoints, tool, scale, finishUtilityDraft, finishContourDraft, finishAreaBoundsDraft, holeDraft, areaHoles, wallWidthFt]);

  // Escape/Enter shortcuts for finishing a polygon/line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraftPoints([]);
        setCalibPts([]);
        setUtilityDraftPts([]);
        setContourDraftPts([]);
        setAreaDraftPts([]);
        setHoleDraft(null);
        setAreaHoles([]);
        setSymbolPts([]);
      }
      else if (e.key === "Enter") finishDraft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft]);

  // ── Persistence ───────────────────────────────────────────────────────────
  async function saveCalibration(pointA: Pt, pointB: Pt, knownDistanceFt: number) {
    const res = await fetch("/api/takeoff/canvas/calibration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId, page_id: pageId,
        point_a: pointA, point_b: pointB,
        known_distance: knownDistanceFt, known_unit: "LF",
      }),
    });
    if (res.ok) {
      const data = await res.json() as { calibration: Calibration };
      setCalibration(data.calibration);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Calibration failed: ${err.error ?? res.status}`);
    }
  }

  // ── "Auto-Select Layer Topology" — scan CAD vectors on C-TOPO/PGCONT
  // layers, read their nearest numeric text label as elevation, and turn
  // them into topo nodes automatically. ──
  const TOPO_LAYER_RE = /C-TOPO|PGCONT/i;
  async function runAutoTopoMatch() {
    setAutoTopoStatus("Scanning CAD layers…");
    try {
      const res = await fetch(`/api/takeoff/canvas/vectors?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" });
      if (!res.ok) { setAutoTopoStatus("Could not load vectors."); return; }
      const data = await res.json() as { vectors?: Array<{ layer: string; type: string; points: Array<[number, number]>; text_tag?: string }> };
      const vectors = data.vectors ?? [];
      const matches = vectors.filter((v) => TOPO_LAYER_RE.test(v.layer));
      let matched = 0;
      const nodes: TopoNode[] = [];
      for (const v of matches) {
        const numMatch = (v.text_tag ?? "").match(/-?\d{2,4}(\.\d+)?/);
        if (!numMatch) continue; // no nearby elevation label — skip rather than guess
        const elevation = Number(numMatch[0]);
        if (!Number.isFinite(elevation)) continue;
        // Vector coordinates are real-world units (feet); convert to canvas
        // pixel space the same way the page calibration defines it.
        const points: Pt[] = v.points.map(([vx, vy]) => ({ x: vx / scale, y: vy / scale }));
        const nodeType = v.type === "point" || points.length === 1 ? "spot_elevation" : "contour_line";
        nodes.push({
          key: `auto-${nodeType}-${matched}-${Date.now()}`,
          node_type: nodeType,
          points,
          coordinateSpace: "legacy_pixel",
          elevation,
          layer_assignment: v.layer,
        });
        matched++;
      }
      if (nodes.length > 0) setTopoNodes((prev) => [...prev, ...nodes]);
      setAutoTopoStatus(`Matched ${nodes.length} of ${matches.length} candidate lines on C-TOPO/PGCONT layers.`);
    } catch {
      setAutoTopoStatus("Auto-match failed.");
    }
  }

  // ── Whole-object drag (move) for an already-saved Shape ──────────────────
  // Translation never changes length/area/count, so no quantity recompute
  // is needed during the drag itself — only the geometry moves. Dragging is
  // only offered for already-saved objects (s.id/s.row_version present);
  // a not-yet-saved draft shape has no server row to PATCH against yet.
  const beginShapeDrag = useCallback((e: React.MouseEvent, s: Shape) => {
    if (tool !== "pan" || !s.saved || !s.id || s.row_version == null) return;
    e.stopPropagation();
    setSelectedKey(s.key);
    dragCleanupRef.current?.();

    const drag = {
      key: s.key,
      originalPoints: s.points,
      originalHoles: s.holes,
      originalRowVersion: s.row_version,
      coordinateSpace: s.coordinateSpace,
    };
    const originX = e.clientX;
    const originY = e.clientY;
    const scaleAtDrag = renderScale;
    const node = e.currentTarget as SVGGElement;
    let frame = 0;
    let dx = 0;
    let dy = 0;
    let cleanup = () => {};
    const onUp = () => {
      cleanup();
      node.removeAttribute("transform");
      if (dx === 0 && dy === 0) return;
      const finalPoints = translateStoredPoints(drag.originalPoints, drag.coordinateSpace, dx, dy, scaleAtDrag);
      const finalHoles = translateStoredRings(drag.originalHoles, drag.coordinateSpace, dx, dy, scaleAtDrag);
      setShapes((prev) => prev.map((shape) => (shape.key === drag.key ? { ...shape, points: finalPoints, holes: finalHoles ?? shape.holes } : shape)));
      void commitShapeDragRef.current(drag, finalPoints, finalHoles);
    };
    const onMove = (ev: MouseEvent) => {
      dx = ev.clientX - originX;
      dy = ev.clientY - originY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        node.setAttribute("transform", `translate(${dx} ${dy})`);
      });
    };
    cleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [tool, renderScale]);

  const commitShapeDrag = useCallback(async (drag: { key: string; originalPoints: Pt[]; originalHoles?: Pt[][]; originalRowVersion: number }, finalPoints: Pt[], finalHoles?: Pt[][]) => {
    const s = shapes.find((x) => x.key === drag.key);
    if (!s || !s.id) return;
    // No actual movement (e.g. a click that never crossed drag threshold) —
    // nothing to persist.
    if (samePoints(finalPoints, drag.originalPoints)) return;

    const res = await fetch("/api/takeoff/canvas/manual", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: s.id, row_version: drag.originalRowVersion,
        quantity: s.quantity, unit: s.unit, cost_code: s.cost_code || null,
        geometry: {
          points: finalPoints,
          ...(finalHoles && finalHoles.length > 0 ? { holes: finalHoles } : {}),
          ...(s.label ? { description: s.label } : {}),
          coordinate_space: "page_space",
        },
      }),
    });

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      // Minimal conflict UX (STEP 2's required pair: reload server / discard
      // local) — a fuller side-by-side diff modal with "save as new object"
      // and "retry after review" is deferred, see REMAINING_RISKS.md.
      const reload = await confirm({
        title: "Measurement changed elsewhere",
        description: "Someone else, or another tab, saved this measurement after you loaded it. Reload the server version and discard this drag, or keep the unsaved local position and drag it again to retry.",
        confirmLabel: "Reload server",
        cancelLabel: "Keep local",
      });
      if (reload && body.server_state) {
        const serverState = body.server_state as { points?: Pt[]; quantity: number; row_version: number };
        setShapes((prev) => prev.map((x) => (x.key === drag.key
          ? { ...x, points: serverState.points ?? drag.originalPoints, quantity: serverState.quantity, row_version: serverState.row_version }
          : x)));
      }
      // else: keep the local drag position as-is (still tagged saved:true
      // but with an unpersisted position) — the user's next drag or edit on
      // this object will attempt to PATCH again with the same
      // row_version and either succeed (if nothing else changed) or
      // conflict again correctly.
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Move failed: ${err.error ?? res.status}`);
      setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, points: drag.originalPoints, holes: drag.originalHoles } : x)));
      return;
    }

    const body = await res.json() as { manual_takeoff: { row_version: number }; quantity: number };
    setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, row_version: body.manual_takeoff.row_version, quantity: body.quantity } : x)));
  }, [shapes, confirm]);
  commitShapeDragRef.current = commitShapeDrag;

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  async function saveAllUnsaved() {
    const unsaved = shapes.filter((s) => !s.saved);
    const unsavedRuns = utilityRuns.filter((r) => !r.saved);
    const unsavedTopo = topoNodes.filter((n) => !n.saved);
    const unsavedAreas = areaBounds.filter((a) => !a.saved);
    if (unsaved.length === 0 && unsavedRuns.length === 0 && unsavedTopo.length === 0 && unsavedAreas.length === 0) return;
    setSaving(true);
    try {
      const requests: Promise<Response>[] = [];

      // Freshly-drawn items are tagged 'legacy_pixel' at creation — this
      // render's current pixel space (see toDisplayPoints/CoordinateSpace
      // above) — so pointsToPageSpace(points, renderScale) converts them
      // correctly. An item can also already be 'page_space' here (e.g. a
      // previously-saved item marked unsaved again by a cost-code edit) —
      // re-running pointsToPageSpace on already-page-space points would
      // divide by renderScale a second time and corrupt them, so those pass
      // through untouched. Persisted geometry is always tagged 'page_space'
      // going forward so it survives window-size/zoom changes on reload
      // (PERMANENT RULE 1/2); `client_key` is the item's own stable id, used
      // by the API for upsert-on-retry idempotency (RULE 13).
      const toPersistedPoints = (points: Pt[], coordinateSpace: CoordinateSpace): Pt[] =>
        coordinateSpace === "page_space" ? points : pointsToPageSpace(points, renderScale);

      let manualSaveRequest: Promise<Response> | null = null;
      if (unsaved.length > 0) {
        const items = unsaved.map((s) => ({
          project_id: projectId,
          page_id: pageId,
          cost_code: s.cost_code || null,
          takeoff_type: s.tool,
          quantity: Number(s.quantity.toFixed(3)),
          unit: s.unit,
          client_key: s.key,
          geometry: {
            points: toPersistedPoints(s.points, s.coordinateSpace),
            ...(s.holes && s.holes.length > 0 ? { holes: s.holes.map((ring) => toPersistedPoints(ring, s.coordinateSpace)) } : {}),
            ...(s.label ? { description: s.label } : {}),
            coordinate_space: "page_space",
            page_number: pageNumber,
          },
        }));
        manualSaveRequest = fetch("/api/takeoff/canvas/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        requests.push(manualSaveRequest);
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
          client_key: r.key,
          geometry: { points: toPersistedPoints(r.points, r.coordinateSpace), coordinate_space: "page_space", page_number: pageNumber },
        }));
        requests.push(fetch("/api/takeoff/canvas/utility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        }));
      }

      if (unsavedTopo.length > 0) {
        const items = unsavedTopo.map((n) => ({
          project_id: projectId,
          page_id: pageId,
          node_type: n.node_type,
          elevation: n.elevation,
          layer_assignment: n.layer_assignment ?? "manual",
          client_key: n.key,
          geometry: { points: toPersistedPoints(n.points, n.coordinateSpace), coordinate_space: "page_space", page_number: pageNumber },
        }));
        requests.push(fetch("/api/takeoff/canvas/topo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        }));
      }

      if (unsavedAreas.length > 0) {
        const items = unsavedAreas.map((a) => ({
          project_id: projectId,
          page_id: pageId,
          boundary_kind: a.boundary_kind,
          area_sf: a.area_sf,
          stripping_depth_in: a.depth_in ?? null,
          excavation_volume_cy: a.volume_cy ?? null,
          target_cost_code: a.target_cost_code || null,
          client_key: a.key,
          boundary_geometry: { points: toPersistedPoints(a.points, a.coordinateSpace), coordinate_space: "page_space", page_number: pageNumber },
        }));
        requests.push(fetch("/api/takeoff/canvas/area-bounds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        }));
      }

      const results = await Promise.all(requests);
      const allOk = results.every((r) => r.ok);
      if (allOk) {
        // Local state must match what was actually persisted: both the
        // points AND the coordinateSpace tag flip together, or a later
        // re-save (e.g. a cost-code edit marking this item unsaved again)
        // would re-run toPersistedPoints on already-page-space points using
        // a still-'legacy_pixel' tag and divide by renderScale a second time.
        let byClientKey = new Map<string, { id: string; row_version: number }>();
        if (manualSaveRequest) {
          const manualData = await (await manualSaveRequest).json().catch(() => ({})) as { items?: Array<{ id: string; client_key: string; row_version: number }> };
          byClientKey = new Map((manualData.items ?? []).map((it) => [it.client_key, { id: it.id, row_version: it.row_version }]));
        }
        setShapes((prev) => prev.map((s) => (s.saved
          ? s
          : { ...s, points: toPersistedPoints(s.points, s.coordinateSpace), coordinateSpace: "page_space", saved: true, ...(byClientKey.get(s.key) ?? {}) })));
        setUtilityRuns((prev) => prev.map((r) => (r.saved ? r : { ...r, points: toPersistedPoints(r.points, r.coordinateSpace), coordinateSpace: "page_space", saved: true })));
        setTopoNodes((prev) => prev.map((n) => (n.saved ? n : { ...n, points: toPersistedPoints(n.points, n.coordinateSpace), coordinateSpace: "page_space", saved: true })));
        setAreaBounds((prev) => prev.map((a) => (a.saved ? a : { ...a, points: toPersistedPoints(a.points, a.coordinateSpace), coordinateSpace: "page_space", saved: true })));
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
  function removeTopoNode(key: string) {
    setTopoNodes((prev) => prev.filter((n) => n.key !== key));
  }
  function removeAreaBound(key: string) {
    setAreaBounds((prev) => prev.filter((a) => a.key !== key));
  }
  function updateAreaCostCode(key: string, code: string) {
    setAreaBounds((prev) => prev.map((a) => (a.key === key ? { ...a, target_cost_code: code, saved: false } : a)));
  }

  // ── "Compile to civil_surfaces" — push all topo nodes into the site
  // surface mesh model for cut/fill grid calculations. ──
  const [compilingMesh, setCompilingMesh] = useState(false);
  async function compileToSurfaceMesh() {
    if (topoNodes.length === 0) return;
    setCompilingMesh(true);
    try {
      // `scale` (calibration.scale_ratio) converts CURRENT-RENDER pixels to
      // real-world feet — page_space points must be projected to this
      // render's pixel space first, or a page_space node would be scaled as
      // if it were already in pixels (wrong by a factor of renderScale).
      const coordinateMesh = topoNodes.flatMap((n) => toDisplayPoints(n.points, n.coordinateSpace).map((p) => ({
        x: Number((p.x * scale).toFixed(2)),
        y: Number((p.y * scale).toFixed(2)),
        elevation: n.elevation,
        node_type: n.node_type,
      })));
      const spotElevations = topoNodes
        .filter((n) => n.node_type === "spot_elevation")
        .map((n) => {
          const p = toDisplayPoints(n.points, n.coordinateSpace)[0];
          return {
            x: Number((p.x * scale).toFixed(2)),
            y: Number((p.y * scale).toFixed(2)),
            elevation: n.elevation,
          };
        });
      const res = await fetch("/api/earthwork/surfaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          surface_type: "topo_survey",
          name: `Canvas Topo — Page ${pageNumber}`,
          units: "ft",
          coordinate_mesh: coordinateMesh,
          spot_elevations: spotElevations,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Compile to surface mesh failed: ${err.error ?? res.status}`);
      }
    } finally {
      setCompilingMesh(false);
    }
  }

  async function publishExistingGrade() {
    const contours = topoNodes
      .filter((node) => node.node_type === "contour_line")
      .map((node) => ({ elevation: node.elevation, points: toDisplayPoints(node.points, node.coordinateSpace) }));
    const spots = topoNodes.flatMap((node) => {
      if (node.node_type !== "spot_elevation") return [];
      const point = toDisplayPoints(node.points, node.coordinateSpace)[0];
      return point ? [{ x: point.x, y: point.y, elevation: node.elevation }] : [];
    });
    const points = topoToSurfacePoints(contours, spots, scale);
    if (points.length < 3) {
      alert("Draw at least three contour vertices or spot elevations before publishing a grade.");
      return;
    }
    setPublishingGrade(true);
    try {
      const res = await fetch("/api/cut-fill/surfaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: `Sheet topo — Page ${pageNumber}`,
          type: "existing",
          points,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Could not publish existing grade: ${err.error ?? res.status}`);
      }
    } finally {
      setPublishingGrade(false);
    }
  }

  async function countSymbolCrop(a: Pt, b: Pt) {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (w < 4 || h < 4) return;
    const name = window.prompt("Symbol name", "symbol");
    if (name == null) return;
    setSymbolBusy(true);
    try {
      const crop = document.createElement("canvas");
      crop.width = Math.max(1, Math.round(w));
      crop.height = Math.max(1, Math.round(h));
      const cropCtx = crop.getContext("2d");
      if (!cropCtx) return;
      cropCtx.drawImage(cvs, x, y, w, h, 0, 0, crop.width, crop.height);
      const pageBlob = await new Promise<Blob | null>((resolve) => cvs.toBlob(resolve, "image/png"));
      const templateBlob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, "image/png"));
      if (!pageBlob || !templateBlob) return;
      const body = new FormData();
      body.set("page", pageBlob, "page.png");
      body.set("template", templateBlob, "template.png");
      body.set("class_name", name || "symbol");
      body.set("threshold", "0.8");
      const res = await fetch("/api/vision/count-template", { method: "POST", body });
      const data = await res.json().catch(() => ({})) as { error?: string; matches?: Array<{ x: number; y: number }> };
      if (!res.ok) {
        alert(`Symbol count failed: ${data.error ?? res.status}`);
        return;
      }
      const matches = data.matches ?? [];
      if (matches.length === 0) {
        alert(`No copies of ${name || "symbol"} found on this sheet.`);
        return;
      }
      setShapes((prev) => [...prev, ...matches.map((match, index) => ({
        key: `sym-${Date.now()}-${index}`,
        tool: "count" as const,
        points: [{ x: match.x + crop.width / 2, y: match.y + crop.height / 2 }],
        coordinateSpace: "legacy_pixel" as const,
        quantity: 1,
        unit: "EA" as const,
        label: name || "symbol",
      }))]);
    } finally {
      setSymbolBusy(false);
    }
  }

  // ── "Commit Area to Earthwork" — push a boundary's excavation volume into
  // earthwork_volumes as a localized deduction layer. ──
  const [committingAreaKey, setCommittingAreaKey] = useState<string | null>(null);
  async function commitAreaToEarthwork(a: AreaBound) {
    setCommittingAreaKey(a.key);
    try {
      const res = await fetch("/api/earthwork/volumes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          layer_name: "area_bounds_deductions",
          deduction: {
            kind: a.boundary_kind,
            area_sf: a.area_sf,
            depth_in: a.depth_in ?? null,
            volume_cy: a.volume_cy ?? 0,
            area_limit_id: a.id ?? null,
            source: "canvas_area_bounds",
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Commit to earthwork failed: ${err.error ?? res.status}`);
      }
    } finally {
      setCommittingAreaKey(null);
    }
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
            {(["pan", "calibrate", "count", "length", "area", "symbol", "utility_pipe", "spot_elevation", "contour_line", "civil_area_bounds"] as Tool[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTool(t); setDraftPoints([]); setCalibPts([]); setUtilityDraftPts([]); setContourDraftPts([]); setAreaDraftPts([]); setHoleDraft(null); setSymbolPts([]); }}
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

          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/40">
            {calibration ? (
              <>
                {calibration.status === "verified" ? (
                  <span className="text-[#CCFF00]" title="Page-space calibration — stable across zoom, resize, and reload">
                    ✓ Verified · {calibration.page_space_scale_factor?.toFixed(4)} {calibration.unit_type}/page-unit
                  </span>
                ) : (
                  <span className="text-amber-400" title="This calibration predates the page-space model and is render-scale-dependent — recalibrate before approving new measurements or syncing to the estimate">
                    ⚠ Legacy scale — needs recalibration
                    {calibration.scale_ratio != null && <> ({calibration.scale_ratio.toFixed(4)} ft/px at save time)</>}
                  </span>
                )}
                {sheetTie && (
                  <span className="text-[#CCFF00]" title="Held in this sheet session. Not written to the project row.">
                    EPSG {sheetTie.epsg} · origin {applySheetTransform([{ x: 0, y: 0 }], sheetTie)[0].x.toFixed(0)},{applySheetTransform([{ x: 0, y: 0 }], sheetTie)[0].y.toFixed(0)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    // Existing saved measurements each store their OWN
                    // computed quantity independently — recalibrating never
                    // retroactively changes them (approved quantities can
                    // never silently change, STEP 5). It only changes what
                    // scale NEW draws use going forward, so the confirmation
                    // here is about that distinction, not a batch recompute.
                    const ok = await confirm({
                      title: "Recalibrate this sheet?",
                      description: "The new scale applies to measurements drawn from now on. Existing saved measurements keep their quantities.",
                      confirmLabel: "Recalibrate",
                      cancelLabel: "Cancel",
                    });
                    if (!ok) return;
                    setTool("calibrate"); setDraftPoints([]); setCalibPts([]);
                  }}
                  className="rounded-full border border-white/10 px-2 py-0.5 text-white/60 hover:text-white hover:bg-white/[0.06] normal-case tracking-normal"
                >
                  Recalibrate
                </button>
              </>
            ) : (
              <span className="text-amber-400">Not calibrated — pick <b>calibrate</b> tool</span>
            )}
          </div>
        </div>

        {tool === "calibrate" && (
          <div className="flex flex-wrap items-end gap-2 border-t border-white/5 bg-white/[0.02] px-4 py-2 text-[10px] font-mono text-white/50">
            <label>EPSG
              <input value={surveyEpsg} onChange={(e) => setSurveyEpsg(Number(e.target.value) || 2276)} className="ml-1 w-16 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white" />
            </label>
            <label>A easting
              <input value={tieA.e} onChange={(e) => setTieA((prev) => ({ ...prev, e: e.target.value }))} className="ml-1 w-24 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white" />
            </label>
            <label>A northing
              <input value={tieA.n} onChange={(e) => setTieA((prev) => ({ ...prev, n: e.target.value }))} className="ml-1 w-24 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white" />
            </label>
            <label>B easting
              <input value={tieB.e} onChange={(e) => setTieB((prev) => ({ ...prev, e: e.target.value }))} className="ml-1 w-24 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white" />
            </label>
            <label>B northing
              <input value={tieB.n} onChange={(e) => setTieB((prev) => ({ ...prev, n: e.target.value }))} className="ml-1 w-24 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white" />
            </label>
            <span>Two clicks use this state-plane pair when both are filled. The tie stays in this session.</span>
          </div>
        )}

        {tool === "length" && (
          <div className="flex items-center gap-2 border-t border-white/5 bg-white/[0.02] px-4 py-2 text-[10px] font-mono text-white/50">
            <label>Wall / paving width (ft)
              <input value={wallWidthFt} onChange={(e) => setWallWidthFt(e.target.value)} placeholder="0" className="ml-1 w-16 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white" />
            </label>
            <span>A width offsets the centerline into an SF area when you commit the line.</span>
          </div>
        )}

        {deletedTakeoffs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-white/5 bg-white/[0.02] px-4 py-2">
            <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">Deleted</span>
            {deletedTakeoffs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={async () => {
                  const res = await fetch("/api/takeoff/canvas/manual", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ restore_id: item.id }),
                  });
                  if (!res.ok) return;
                  const restored = await res.json() as { manual_takeoff?: { id: string; takeoff_type: "count" | "length" | "area"; cost_code: string | null; quantity: number; unit: string | null; row_version?: number; geometry: { points?: Pt[]; coordinate_space?: string } } };
                  const row = restored.manual_takeoff;
                  setDeletedTakeoffs((prev) => prev.filter((x) => x.id !== item.id));
                  if (!row) return;
                  setShapes((prev) => [...prev, {
                    key: `saved-${row.id}`,
                    id: row.id,
                    row_version: row.row_version ?? 1,
                    tool: row.takeoff_type,
                    points: Array.isArray(row.geometry?.points) ? row.geometry.points : [],
                    coordinateSpace: (row.geometry?.coordinate_space === "page_space" ? "page_space" : "legacy_pixel") as CoordinateSpace,
                    quantity: Number(row.quantity),
                    unit: (row.unit ?? (row.takeoff_type === "count" ? "EA" : row.takeoff_type === "length" ? "LF" : "SF")) as Shape["unit"],
                    cost_code: row.cost_code ?? undefined,
                    saved: true,
                  }]);
                }}
                className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/70 hover:text-white"
              >
                Restore {item.takeoff_type} {item.quantity} {item.unit ?? ""}
              </button>
            ))}
          </div>
        )}

        {/* Context bar: topo auto-match toggle + area-bounds boundary config */}
        {(tool === "contour_line" || tool === "spot_elevation") && (
          <div className="flex items-center gap-3 border-t border-white/5 bg-white/[0.02] px-4 py-2">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/60">
              <input
                type="checkbox"
                checked={autoTopoMatching}
                onChange={(e) => { setAutoTopoMatching(e.target.checked); if (e.target.checked) void runAutoTopoMatch(); }}
                className="accent-[#CCFF00]"
              />
              Auto-Select Layer Topology
            </label>
            {autoTopoStatus && <span className="text-[10px] text-white/40">{autoTopoStatus}</span>}
          </div>
        )}
        {tool === "civil_area_bounds" && (
          <div className="flex items-center gap-3 border-t border-white/5 bg-white/[0.02] px-4 py-2">
            <label className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">Boundary Type</span>
              <select
                value={areaBoundaryKind}
                onChange={(e) => setAreaBoundaryKind(e.target.value as BoundaryKind)}
                className="bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-white focus:outline-none focus:border-[#CCFF00]"
              >
                {AREA_BOUNDARY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
            {DEPTH_APPLICABLE_KINDS.has(areaBoundaryKind) && (
              <label className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest font-mono text-white/40">Depth (in)</span>
                <input
                  type="number" min={0.5} step={0.5} value={areaDepthIn}
                  onChange={(e) => setAreaDepthIn(Number(e.target.value))}
                  className="w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-white focus:outline-none focus:border-[#CCFF00]"
                />
              </label>
            )}
          </div>
        )}

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
              onMouseMove={(event) => {
                if (tool === "pan" || !renderSize) {
                  setSnapCursor(null);
                  return;
                }
                const local = toLocal(event.clientX, event.clientY, event.currentTarget);
                setSnapCursor(nearestSnap(snapIndex, local.x, local.y, 12));
              }}
              onMouseLeave={() => setSnapCursor(null)}
            >
              <SavedMarkup
                shapes={shapes}
                utilityRuns={utilityRuns}
                topoNodes={topoNodes}
                areaBounds={areaBounds}
                selectedKey={selectedKey}
                renderScale={renderScale}
                canDrag={tool === "pan"}
                onSelect={setSelectedKey}
                onDragStart={beginShapeDrag}
              />

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

              {/* Draft (in-progress) contour line */}
              {tool === "contour_line" && contourDraftPts.length > 0 && (
                <g>
                  <path
                    d={contourDraftPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")}
                    stroke="#22d3ee" strokeWidth={2} strokeDasharray="6 4" fill="none"
                  />
                  {contourDraftPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#22d3ee" strokeWidth={1.5} />
                  ))}
                </g>
              )}

              {/* Draft (in-progress) area bounds polygon */}
              {tool === "civil_area_bounds" && areaDraftPts.length > 0 && (
                <g>
                  {areaDraftPts.length >= 3 && (
                    <path d={triangleFillPath(areaDraftPts)} fill="#f9731622" stroke="none" />
                  )}
                  <path
                    d={areaDraftPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + (areaDraftPts.length >= 3 ? " Z" : "")}
                    stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" fill="none"
                  />
                  {areaDraftPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#f97316" strokeWidth={1.5} />
                  ))}
                </g>
              )}

              {/* Draft (in-progress) polyline / polygon */}
              {draftPoints.length > 0 && (
                <g>
                  {tool === "area" && draftPoints.length >= 3 && (
                    <path d={triangleFillPath(draftPoints)} fill="#f9731633" stroke="none" />
                  )}
                  {areaHoles.map((ring, index) => (
                    <path key={`hole-${index}`} d={ring.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z"} fill="#06070A" fillOpacity={0.55} stroke="#f97316" strokeWidth={1} />
                  ))}
                  {holeDraft && holeDraft.length > 0 && (
                    <path d={holeDraft.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")} stroke="#CCFF00" strokeWidth={1.5} fill="none" strokeDasharray="4 3" />
                  )}
                  <path
                    d={draftPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + (tool === "area" && draftPoints.length >= 3 ? " Z" : "")}
                    stroke={tool === "area" ? "#f97316" : "#00D2FF"}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    fill="none"
                  />
                  {draftPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#000" strokeWidth={1} />
                  ))}
                </g>
              )}

              {snapCursor && (
                <circle cx={snapCursor.x} cy={snapCursor.y} r={12} fill="none" stroke="#CCFF00" strokeWidth={1} />
              )}

              {/* Calibration guide */}
              {symbolPts.length > 0 && (
                <g>
                  {symbolPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={4} fill="#CCFF00" stroke="#000" strokeWidth={1} />
                  ))}
                </g>
              )}

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
            scaleRatio={scale}
            onVectorsLoaded={setVectorDescriptions}
            onScreenPoints={onCadScreenPoints}
            onCommitted={(m) => {
              // Mirror an approved CAD vector into the local shapes dock so
              // estimators see it immediately without needing to reload.
              setShapes((prev) => [...prev, {
                key: `cad-${Date.now()}`,
                tool: m.takeoff_type,
                points: Array.isArray((m.geometry as { points?: { x: number; y: number }[] })?.points)
                  ? ((m.geometry as { points: { x: number; y: number }[] }).points)
                  : [],
                coordinateSpace: "legacy_pixel",
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

        {tool === "contour_line" && contourDraftPts.length > 0 && (
          <div className="fixed bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-black/80 px-3 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Contour Draft</div>
            <div className="mt-0.5 text-sm">
              <span className="text-[#22d3ee] font-mono">{contourDraftPts.length}</span> point{contourDraftPts.length === 1 ? "" : "s"}
              <span className="ml-3 text-[10px] text-white/40">Enter/double-click = set elevation · Esc = cancel</span>
            </div>
          </div>
        )}

        {tool === "civil_area_bounds" && areaDraftPts.length > 0 && (
          <div className="fixed bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-black/80 px-3 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Area Bounds Draft</div>
            <div className="mt-0.5 text-sm">
              <span className="text-orange-400 font-mono">{areaDraftPreview.sf.toFixed(1)}</span> SF
              {areaDraftPreview.cy !== null && (
                <> · <span className="text-orange-400 font-mono">{areaDraftPreview.cy.toFixed(2)}</span> CY</>
              )}
              <span className="ml-3 text-[10px] text-white/40">Enter/double-click = close polygon · Esc = cancel</span>
            </div>
          </div>
        )}

        {tool === "symbol" && (
          <div className="fixed bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-black/80 px-3 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Symbol</div>
            <div className="mt-0.5 text-sm text-white/70">
              {symbolBusy ? "Counting copies…" : "Drag a box with two clicks around one symbol."}
            </div>
          </div>
        )}

        {(tool === "length" || tool === "area") && draftPoints.length > 0 && (
          <div className="fixed bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-black/80 px-3 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Draft</div>
            <div className="mt-0.5 text-sm">
              {tool === "length"
                ? <><span className="text-[#00D2FF] font-mono">{draftQuantity.toFixed(2)}</span> LF</>
                : <><span className="text-orange-400 font-mono">{draftQuantity.toFixed(2)}</span> SF{areaHoles.length > 0 ? ` · ${areaHoles.length} hole${areaHoles.length === 1 ? "" : "s"}` : ""}</>
              }
              {tool === "area" && (
                <button type="button" onClick={() => setHoleDraft(holeDraft ? null : [])} className="ml-3 rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/70 hover:text-white">
                  {holeDraft ? "Drawing hole" : "Add hole"}
                </button>
              )}
              <span className="ml-3 text-[10px] text-white/40">{holeDraft ? "Enter = close hole · Esc = cancel" : "Enter = commit · Esc = cancel"}</span>
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
              coordinateSpace: "legacy_pixel",
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
                  <span className="col-span-3 text-white/35">
                    Prism {trenchPrism({
                      length_lf: r.run_length_lf,
                      width_ft: r.inputs.trench_width_ft,
                      depth_ft: 4,
                      bedding_ft: 0.5,
                    }).excavation_cy.toFixed(1)} CY at 4 ft cover
                  </span>
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

        {topoNodes.length > 0 && (
          <div className="border-t border-white/10 px-3 py-2 space-y-1.5 max-h-[30vh] overflow-y-auto">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] uppercase tracking-widest font-mono text-[#22d3ee]">Topo Nodes · {topoNodes.length}</span>
              <button
                type="button"
                onClick={compileToSurfaceMesh}
                disabled={compilingMesh}
                className="text-[9px] uppercase tracking-widest font-mono text-[#22d3ee] hover:opacity-70 disabled:opacity-40"
              >
                {compilingMesh ? "Compiling…" : "Compile to Surface Mesh"}
              </button>
              <button
                type="button"
                onClick={() => { void publishExistingGrade(); }}
                disabled={publishingGrade}
                className="text-[9px] uppercase tracking-widest font-mono text-[#22d3ee] hover:opacity-70 disabled:opacity-40"
              >
                {publishingGrade ? "Publishing…" : "Use as existing grade"}
              </button>
            </div>
            {topoNodes.map((n) => (
              <div key={n.key} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5">
                <div className="text-[11px]">
                  <span className="text-[9px] uppercase tracking-widest font-mono text-[#22d3ee]">{n.node_type === "spot_elevation" ? "Spot" : "Contour"}</span>
                  <span className="ml-2 font-mono">{n.elevation.toFixed(2)}&apos;</span>
                  <span className="ml-2 text-white/30 text-[10px]">{n.layer_assignment}</span>
                </div>
                <button type="button" onClick={() => removeTopoNode(n.key)} className="text-[10px] text-white/30 hover:text-red-400">✕</button>
              </div>
            ))}
          </div>
        )}

        {areaBounds.length > 0 && (
          <div className="border-t border-white/10 px-3 py-2 space-y-1.5 max-h-[35vh] overflow-y-auto">
            <div className="px-1 text-[10px] uppercase tracking-widest font-mono text-orange-400">Area Bounds · {areaBounds.length}</div>
            {areaBounds.map((a) => {
              const kindLabel = AREA_BOUNDARY_KINDS.find((k) => k.value === a.boundary_kind)?.label ?? a.boundary_kind;
              return (
                <div key={a.key} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] uppercase tracking-widest font-mono text-orange-400">{kindLabel}</span>
                      <div className="text-sm font-mono">
                        {a.area_sf.toFixed(1)} <span className="text-white/40">SF</span>
                        {a.volume_cy != null && <span className="text-white/40 text-xs"> · {a.volume_cy.toFixed(2)} CY</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeAreaBound(a.key)} className="text-[10px] text-white/30 hover:text-red-400">✕</button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="text" placeholder="NN-NN-NN" value={a.target_cost_code ?? ""}
                      onChange={(e) => updateAreaCostCode(a.key, e.target.value)}
                      className={`flex-1 rounded border px-2 py-1 text-[11px] font-mono bg-black/40 focus:outline-none focus:border-[#CCFF00] ${
                        a.target_cost_code && !/^\d{2}-\d{2}-\d{2}$/.test(a.target_cost_code) ? "border-red-400/50" : "border-white/10"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => commitAreaToEarthwork(a)}
                      disabled={committingAreaKey === a.key}
                      className="shrink-0 text-[9px] uppercase tracking-widest font-mono text-orange-400 hover:opacity-70 disabled:opacity-40"
                    >
                      {committingAreaKey === a.key ? "Committing…" : "Commit to Earthwork"}
                    </button>
                  </div>
                  {a.saved && <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Saved</span>}
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={saveAllUnsaved}
            disabled={saving
              || ([...shapes, ...utilityRuns, ...topoNodes, ...areaBounds].every((x) => x.saved))
              || (shapes.length === 0 && utilityRuns.length === 0 && topoNodes.length === 0 && areaBounds.length === 0)}
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
