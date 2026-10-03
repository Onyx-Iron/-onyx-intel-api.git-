"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import CADVectorLayer from "./CADVectorLayer";
import VisionExtractionsPanel from "./VisionExtractionsPanel";
import { extractVectorsFromPdfPage } from "@/lib/cad/pdf-vector-extract";
import { calcPipeEmbedment } from "@/lib/math/civil-scope";
import { utilityRecipeFromRun, wallRecipeLines } from "@/lib/math/scope-recipes";
import type { RebarSize } from "@/lib/math/assemblies";
import { pointsToPageSpace, pointsToScreenSpace, toPageSpace } from "@/lib/takeoff/canvas/coordinates";
import { cachedPdfDocument } from "@/lib/takeoff/canvas/pdf-cache";
import { CANVAS_HOTKEY_HINT, resolveCanvasHotkey, type CanvasTool } from "@/lib/takeoff/canvas/hotkeys";
import { buildQuantitySummary } from "@/lib/takeoff/canvas/quantity-summary";
import { CommandStack } from "@/lib/takeoff/canvas/command-stack";
import { PersistedGeometryRevision } from "@/lib/takeoff/canvas/persisted-geometry-revision";
import TakeoffLayersPanel from "./TakeoffLayersPanel";
import PlaceAssemblyPanel from "./PlaceAssemblyPanel";
import {
  DEFAULT_SNAP_THRESHOLD_PX,
  type VectorPoint,
} from "@/lib/takeoff/canvas/vector-snap";
import { takeoffQueryKeys, useSheetCalibration } from "@/lib/takeoff/queries";
import type { SnapResult } from "@/lib/takeoff/canvas/snap-algorithm";

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
type Tool = CanvasTool;

/** Tools where cursor magnetic-snap to CAD/PDF vector vertices is useful. */
const SNAP_TOOLS: ReadonlySet<Tool> = new Set([
  "calibrate",
  "count",
  "length",
  "area",
  "utility_pipe",
  "spot_elevation",
  "contour_line",
  "civil_area_bounds",
]);

interface Pt { x: number; y: number }

interface Shape {
  key: string;                // client-side id
  id?: string;                // server id once saved — required to PATCH an existing object
  row_version?: number;       // optimistic-concurrency version last read from the server (see update_manual_takeoff_tx)
  tool: "count" | "length" | "area";
  points: Pt[];               // coords in `coordinateSpace` (see toDisplayPoints)
  coordinateSpace: CoordinateSpace;
  quantity: number;           // computed (count: N; length: LF; area: SF)
  unit: "EA" | "LF" | "SF";
  cost_code?: string;
  label?: string;
  layer_id?: string | null;
  assembly_key?: string | null;
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

interface WallRun {
  key: string;
  points: Pt[];
  coordinateSpace: CoordinateSpace;
  length_lf: number;
  height_ft: number;
  thickness_in: number;
  rebar_size?: RebarSize;
  rebar_spacing_inches?: number;
  saved?: boolean;
}

interface WallInputs {
  height_ft: number;
  thickness_in: number;
  rebar_size?: RebarSize;
  rebar_spacing_inches?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
type SnapWorkerResponse = { type: "snap-result"; id: number; result: SnapResult };

export default function SheetCanvas({ projectId, projectName, pageId, pageNumber, documentId }: Props) {
  const queryClient = useQueryClient();
  const { data: calibration = null } = useSheetCalibration(pageId);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const priorCanvasRef = useRef<HTMLCanvasElement>(null);
  const [priorUrl, setPriorUrl] = useState<string | null>(null);
  const [priorLabel, setPriorLabel] = useState<string | null>(null);
  const [showPrior, setShowPrior] = useState(false);
  const snapWorkerRef = useRef<Worker | null>(null);
  const snapRequestIdRef = useRef(0);
  const latestSnapRef = useRef<SnapResult | null>(null);
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
  const toolBeforeSpacePan = useRef<Tool | null>(null);
  const [shapes, setShapes]         = useState<Shape[]>([]);
  const [draftPoints, setDraftPoints] = useState<Pt[]>([]);   // in-progress polygon/line points
  const [calibPts, setCalibPts]     = useState<Pt[]>([]);     // during calibrate mode
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [markupMode, setMarkupMode] = useState(false);
  const [markups, setMarkups] = useState<Array<{
    id: string;
    markup_type: string;
    geometry: { points?: Pt[]; text?: string };
    label: string | null;
    color: string;
  }>>([]);
  const commandStackRef = useRef(new CommandStack());
  const [, setCommandTick] = useState(0);
  const [layerOptions, setLayerOptions] = useState<Array<{ id: string; name: string }>>([]);
  // Whole-object drag for saved shapes; vertex drag for length/area when selected.
  const [dragState, setDragState] = useState<{ key: string; startClient: Pt; originalPoints: Pt[]; originalRowVersion: number } | null>(null);
  const [vertexDrag, setVertexDrag] = useState<{
    key: string;
    vertexIndex: number;
    startClient: Pt;
    originalPoints: Pt[];
    originalRowVersion: number | null;
  } | null>(null);
  const [vectorDescriptions, setVectorDescriptions] = useState<string[]>([]);
  const [snapPoints, setSnapPoints] = useState<VectorPoint[]>([]);
  const [snapTarget, setSnapTarget] = useState<{ point: VectorPoint; distance: number } | null>(null);
  const [utilityRuns, setUtilityRuns] = useState<UtilityRun[]>([]);
  const [utilityDraftPts, setUtilityDraftPts] = useState<Pt[]>([]);
  const [utilityModalPts, setUtilityModalPts] = useState<Pt[] | null>(null); // non-null while the input overlay is open
  const [wallMode, setWallMode] = useState(false);
  const [wallRuns, setWallRuns] = useState<WallRun[]>([]);
  const [wallModalPts, setWallModalPts] = useState<Pt[] | null>(null);

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

  // ── Snap worker: nearest-vertex search off the main thread ───────────────
  useEffect(() => {
    const worker = new Worker(new URL("../../../workers/snap.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<SnapWorkerResponse>) => {
      const { id, result } = event.data;
      if (id !== snapRequestIdRef.current) return;
      latestSnapRef.current = result;
      setSnapTarget(result.snapped ? { point: result.point, distance: result.distance } : null);
    };
    snapWorkerRef.current = worker;
    return () => {
      worker.terminate();
      snapWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    snapWorkerRef.current?.postMessage({ type: "set-points", vectorPoints: snapPoints });
  }, [snapPoints]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/takeoff/layers?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { layers?: Array<{ id: string; name: string }> };
        if (!cancelled) setLayerOptions((data.layers ?? []).map((l) => ({ id: l.id, name: l.name })));
      } catch {
        /* ignore — properties select stays empty */
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // ── Load signed URL + saved takeoffs (calibration via React Query) ───────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [urlRes, mtRes, utRes, topoRes, areaRes, wallRes, markupRes] = await Promise.all([
          fetch(`/api/takeoff/canvas/page-url?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/manual?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/utility?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/topo?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/area-bounds?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/canvas/wall?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
          fetch(`/api/takeoff/markups?project_id=${encodeURIComponent(projectId)}&page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" }),
        ]);
        if (!urlRes.ok) throw new Error(`page-url ${urlRes.status}`);
        const urlData = await urlRes.json() as { url: string };
        if (!cancelled) setPdfUrl(urlData.url);

        if (mtRes.ok) {
          const mtData = await mtRes.json() as { items: Array<{ id: string; takeoff_type: "count" | "length" | "area"; cost_code: string | null; label?: string | null; layer_id?: string | null; quantity: number; unit: string | null; row_version?: number; geometry: { points?: Pt[]; coordinate_space?: string; label?: string; assembly_key?: string } }> };
          if (!cancelled) {
            setShapes(mtData.items.map((it) => ({
              key: `saved-${it.id}`,
              id: it.id,
              row_version: it.row_version ?? 1,
              tool: it.takeoff_type,
              points: Array.isArray(it.geometry?.points) ? it.geometry.points : [],
              // Absent/unrecognized tag → 'legacy_pixel' (rows saved before
              // this milestone) — never assumed to be page_space, so old
              // geometry keeps rendering exactly as it always has.
              coordinateSpace: (it.geometry?.coordinate_space === "page_space" ? "page_space" : "legacy_pixel") as CoordinateSpace,
              quantity: Number(it.quantity),
              unit: (it.unit ?? (it.takeoff_type === "count" ? "EA" : it.takeoff_type === "length" ? "LF" : "SF")) as Shape["unit"],
              cost_code: it.cost_code ?? undefined,
              label: it.label ?? it.geometry?.label ?? undefined,
              layer_id: it.layer_id ?? null,
              assembly_key: it.geometry?.assembly_key ?? null,
              saved: true,
            })).filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)); // dedupe by key
          }
        }
        if (utRes.ok) {
          type SavedUtilityRow = {
            id: string; system_type: string; pipe_diameter_in: number;
            invert_elevation_start: number | null; invert_elevation_end: number | null;
            trench_width_ft: number; run_length_lf: number;
            cost_code: string | null; geometry: { points?: Pt[]; coordinate_space?: string } | null;
            computed_trench_json: { trench_excavation_bcy?: number; common_backfill_cy?: number; totals?: { aggregate_import_cy?: number } } | null;
          };
          const utData = await utRes.json() as { items: SavedUtilityRow[] };
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
        if (topoRes.ok) {
          type SavedTopoRow = { id: string; node_type: "contour_line" | "spot_elevation"; elevation: number; layer_assignment: string | null; geometry: { points?: Pt[]; coordinate_space?: string } | null };
          const topoData = await topoRes.json() as { items: SavedTopoRow[] };
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
        if (areaRes.ok) {
          type SavedAreaRow = {
            id: string; boundary_kind: BoundaryKind; area_sf: number; stripping_depth_in: number | null;
            excavation_volume_cy: number | null; target_cost_code: string | null; boundary_geometry: { points?: Pt[]; coordinate_space?: string } | null;
          };
          const areaData = await areaRes.json() as { items: SavedAreaRow[] };
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
        if (wallRes.ok) {
          type SavedWallRow = {
            id: string;
            client_key?: string | null;
            length_lf: number | null;
            height_ft: number | null;
            thickness_in: number | null;
            rebar_size?: string | null;
            rebar_spacing_inches?: number | null;
            geometry?: { points?: Pt[]; coordinate_space?: string } | null;
          };
          const wallData = await wallRes.json() as { items: SavedWallRow[] };
          if (!cancelled) {
            setWallRuns(wallData.items.map((it) => ({
              key: it.client_key || `saved-${it.id}`,
              points: Array.isArray(it.geometry?.points) ? it.geometry.points : [],
              coordinateSpace: (it.geometry?.coordinate_space === "page_space" ? "page_space" : "legacy_pixel") as CoordinateSpace,
              length_lf: Number(it.length_lf ?? 0),
              height_ft: Number(it.height_ft ?? 0),
              thickness_in: Number(it.thickness_in ?? 0),
              rebar_size: (it.rebar_size ?? undefined) as RebarSize | undefined,
              rebar_spacing_inches: it.rebar_spacing_inches ?? undefined,
              saved: true,
            })));
          }
        }
        if (markupRes.ok) {
          const mk = await markupRes.json() as {
            markups?: Array<{
              id: string;
              markup_type: string;
              geometry: { points?: Pt[]; text?: string };
              label: string | null;
              color: string;
            }>;
          };
          if (!cancelled) setMarkups(mk.markups ?? []);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [pageId, projectId]);

  // ── Render the PDF page onto <canvas> via pdfjs-dist ──────────────────────
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
        const doc = await cachedPdfDocument(pdfUrl, () => pdfjs.getDocument({ url: pdfUrl }).promise);
        // Split plan sets store one sheet per file. Always paint page 1 of that file.
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
        await page.render({ canvas: cvs, canvasContext: ctx, viewport }).promise;
        if (!cancelled) {
          setRenderSize({ w: viewport.width, h: viewport.height });
          setRenderScale(scale);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, pageId]);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/takeoff/canvas/prior-revision?document_id=${encodeURIComponent(documentId)}&page_number=${pageNumber}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = await res.json() as { url?: string | null; revision_token?: string | null; file_name?: string | null };
        if (cancelled || !data.url) return;
        setPriorUrl(data.url);
        setPriorLabel(data.revision_token ? `Rev ${data.revision_token}` : (data.file_name ?? "Prior"));
      } catch {
        /* overlay is optional */
      }
    })();
    return () => { cancelled = true; };
  }, [documentId, pageNumber]);

  useEffect(() => {
    if (!showPrior || !priorUrl || renderScale <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await cachedPdfDocument(priorUrl, () => pdfjs.getDocument({ url: priorUrl }).promise);
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: renderScale });
        const cvs = priorCanvasRef.current;
        if (!cvs || cancelled) return;
        cvs.width = viewport.width;
        cvs.height = viewport.height;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas: cvs, canvasContext: ctx, viewport }).promise;
      } catch (e) {
        console.warn("[SheetCanvas] prior revision overlay skipped:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [showPrior, priorUrl, renderScale, pageId]);

  // Vector extraction waits until a civil tool needs the CAD overlay.
  const vectorExtractKey = useRef<string | null>(null);
  useEffect(() => {
    const vectorTools = new Set<Tool>([
      "utility_pipe",
      "contour_line",
      "spot_elevation",
      "civil_area_bounds",
      "length",
      "area",
      "count",
    ]);
    if (!pdfUrl || !vectorTools.has(tool)) return;
    const key = `${pdfUrl}:${pageId}`;
    if (vectorExtractKey.current === key) return;
    vectorExtractKey.current = key;
    let cancelled = false;
    let finished = false;
    (async () => {
      try {
        const check = await fetch(`/api/takeoff/canvas/vectors?page_id=${encodeURIComponent(pageId)}`, { cache: "no-store" });
        const existing = check.ok ? (await check.json() as { vectors?: unknown[] }) : { vectors: [] };
        if ((existing.vectors ?? []).length > 0 || cancelled) {
          finished = true;
          return;
        }
        const pdfjs = await import("pdfjs-dist");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await cachedPdfDocument(pdfUrl, () => pdfjs.getDocument({ url: pdfUrl }).promise);
        const page = await doc.getPage(1);
        const vectors = await extractVectorsFromPdfPage(page);
        if (vectors.length > 0 && !cancelled) {
          await fetch("/api/takeoff/canvas/vectors", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page_id: pageId, vectors }),
          });
          window.setTimeout(() => window.dispatchEvent(new CustomEvent("onyx:cad-vectors-refresh", { detail: { pageId } })), 300);
        }
        finished = true;
      } catch (extractErr) {
        vectorExtractKey.current = null;
        console.warn("[SheetCanvas] PDF vector extraction skipped:", extractErr);
      }
    })();
    return () => {
      cancelled = true;
      if (!finished) vectorExtractKey.current = null;
    };
  }, [pdfUrl, pageId, tool]);

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

  const resolveSnapPoint = useCallback((cursor: Pt): Pt => {
    if (!SNAP_TOOLS.has(tool) || snapPoints.length === 0) return cursor;
    const latest = latestSnapRef.current;
    if (latest?.snapped) {
      const dist = Math.hypot(latest.point.x - cursor.x, latest.point.y - cursor.y);
      if (dist <= DEFAULT_SNAP_THRESHOLD_PX * 1.5) return latest.point;
    }
    return cursor;
  }, [tool, snapPoints]);

  const onCanvasMouseMove: React.MouseEventHandler<SVGSVGElement> = useCallback((e) => {
    if (!SNAP_TOOLS.has(tool) || snapPoints.length === 0) {
      setSnapTarget(null);
      latestSnapRef.current = null;
      return;
    }
    const cursor = toLocal(e.clientX, e.clientY, e.currentTarget);
    const id = ++snapRequestIdRef.current;
    snapWorkerRef.current?.postMessage({
      type: "snap",
      id,
      cursor,
      thresholdPixels: DEFAULT_SNAP_THRESHOLD_PX,
    });
  }, [tool, snapPoints, toLocal]);

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

  const onCanvasMouseLeave = () => setSnapTarget(null);

  // ── Click handling ────────────────────────────────────────────────────────
  const onCanvasClick: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!renderSize) return;
    const raw = toLocal(e.clientX, e.clientY, e.currentTarget);
    const p = resolveSnapPoint(raw);

    // Non-quantity markups (excluded from estimate sync).
    if (markupMode) {
      const label = window.prompt("Markup text (not counted in quantities):", "");
      if (label == null || !label.trim()) return;
      void (async () => {
        const res = await fetch("/api/takeoff/markups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            page_id: pageId,
            markup_type: "text",
            label: label.trim(),
            color: "#F5A623",
            geometry: { points: [p], text: label.trim(), coordinate_space: "legacy_pixel" },
          }),
        });
        if (!res.ok) return;
        const data = await res.json() as {
          markup: {
            id: string;
            markup_type: string;
            geometry: { points?: Pt[]; text?: string };
            label: string | null;
            color: string;
          };
        };
        setMarkups((prev) => [...prev, data.markup]);
      })();
      return;
    }

    if (tool === "calibrate") {
      const next = [...calibPts, p];
      if (next.length === 2) {
        const raw = window.prompt("Enter the real-world distance between the two clicks (feet):", "10");
        if (raw != null) {
          const feet = Number(raw);
          if (Number.isFinite(feet) && feet > 0) {
            const px = pixelDistance(next[0], next[1]);
            // Convert the two CURRENT-render-pixel click points to page
            // space before sending — the server computes and stores
            // page_space_scale_factor from these page-space points itself,
            // never from a render-pixel ratio (STEP 2: never fabricate
            // calibration from current_render_pixels * historical scale).
            if (px > 0) saveCalibration(toPageSpace(next[0], renderScale), toPageSpace(next[1], renderScale), feet);
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
        layer_id: activeLayerId,
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

  const commitWall = useCallback((inputs: WallInputs) => {
    if (!wallModalPts) return;
    const lengthLf = totalLen(wallModalPts) * scale;
    const run: WallRun = {
      key: `w-${Date.now()}`,
      points: wallModalPts,
      coordinateSpace: "legacy_pixel",
      length_lf: lengthLf,
      height_ft: inputs.height_ft,
      thickness_in: inputs.thickness_in,
      rebar_size: inputs.rebar_size,
      rebar_spacing_inches: inputs.rebar_spacing_inches,
    };
    setWallRuns((prev) => [...prev, run]);
    setWallModalPts(null);
    setDraftPoints([]);
  }, [wallModalPts, scale]);

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
    if (draftPoints.length < 2) { setDraftPoints([]); return; }
    if (tool === "length" && wallMode) {
      setWallModalPts(draftPoints);
      return;
    }
    if (tool === "length") {
      const quantity = totalLen(draftPoints) * scale;
      setShapes((prev) => [...prev, {
        key: `l-${Date.now()}`,
        tool: "length",
        points: draftPoints,
        coordinateSpace: "legacy_pixel",
        quantity,
        unit: "LF",
        layer_id: activeLayerId,
      }]);
    } else if (tool === "area" && draftPoints.length >= 3) {
      const quantity = polygonArea(draftPoints) * scale * scale;
      setShapes((prev) => [...prev, {
        key: `a-${Date.now()}`,
        tool: "area",
        points: draftPoints,
        coordinateSpace: "legacy_pixel",
        quantity,
        unit: "SF",
        layer_id: activeLayerId,
      }]);
    }
    setDraftPoints([]);
  }, [draftPoints, tool, scale, wallMode, activeLayerId, finishUtilityDraft, finishContourDraft, finishAreaBoundsDraft]);

  const clearDrafts = useCallback(() => {
    setDraftPoints([]);
    setCalibPts([]);
    setUtilityDraftPts([]);
    setContourDraftPts([]);
    setAreaDraftPts([]);
  }, []);

  const selectTool = useCallback((next: Tool) => {
    toolBeforeSpacePan.current = null;
    setTool(next);
    clearDrafts();
  }, [clearDrafts]);

  const undoLast = useCallback(() => {
    // Prefer undoing an in-progress vertex; otherwise command stack; else drop newest unsaved.
    if (draftPoints.length > 0) {
      setDraftPoints((prev) => prev.slice(0, -1));
      return;
    }
    if (utilityDraftPts.length > 0) {
      setUtilityDraftPts((prev) => prev.slice(0, -1));
      return;
    }
    if (contourDraftPts.length > 0) {
      setContourDraftPts((prev) => prev.slice(0, -1));
      return;
    }
    if (areaDraftPts.length > 0) {
      setAreaDraftPts((prev) => prev.slice(0, -1));
      return;
    }
    if (calibPts.length > 0) {
      setCalibPts((prev) => prev.slice(0, -1));
      return;
    }
    if (commandStackRef.current.canUndo) {
      void commandStackRef.current.undo().then(() => setCommandTick((t) => t + 1));
      return;
    }
    setShapes((prev) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (!prev[i].saved) return [...prev.slice(0, i), ...prev.slice(i + 1)];
      }
      return prev;
    });
  }, [draftPoints.length, utilityDraftPts.length, contourDraftPts.length, areaDraftPts.length, calibPts.length]);

  const redoLast = useCallback(() => {
    if (commandStackRef.current.canRedo) {
      void commandStackRef.current.redo().then(() => setCommandTick((t) => t + 1));
    }
  }, []);

  const toggleSelectKey = useCallback((key: string, additive: boolean) => {
    setSelectedKey(key);
    setSelectedKeys((prev) => {
      if (!additive) return new Set([key]);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const deleteShapesByKeys = useCallback(async (keys: Set<string>) => {
    if (keys.size === 0) return;
    const snapshot = shapes.filter((s) => keys.has(s.key));
    if (snapshot.length === 0) return;

    setShapes((prev) => prev.filter((s) => !keys.has(s.key)));
    setSelectedKeys(new Set());
    setSelectedKey(null);

    const deletedIds: string[] = [];
    for (const s of snapshot) {
      if (!s.id) continue;
      const res = await fetch(`/api/takeoff/canvas/manual?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
      if (res.ok) deletedIds.push(s.id);
      else {
        // Restore local state on failure so the user can retry.
        setShapes((prev) => [...prev, s]);
      }
    }

    commandStackRef.current.record({
      id: `del-${Date.now()}`,
      label: `Delete ${snapshot.length} measurement${snapshot.length === 1 ? "" : "s"}`,
      undo: async () => {
        for (const id of deletedIds) {
          await fetch("/api/takeoff/canvas/manual", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
        }
        setShapes((prev) => {
          const existing = new Set(prev.map((s) => s.key));
          return [...prev, ...snapshot.filter((s) => !existing.has(s.key))];
        });
        setCommandTick((t) => t + 1);
      },
      redo: async () => {
        for (const s of snapshot) {
          if (!s.id) continue;
          await fetch(`/api/takeoff/canvas/manual?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
        }
        setShapes((prev) => prev.filter((s) => !keys.has(s.key)));
        setCommandTick((t) => t + 1);
      },
    });
    setCommandTick((t) => t + 1);
  }, [shapes]);

  const deleteSelection = useCallback(() => {
    const keys = selectedKeys.size > 0 ? selectedKeys : (selectedKey ? new Set([selectedKey]) : new Set<string>());
    void deleteShapesByKeys(keys);
  }, [selectedKeys, selectedKey, deleteShapesByKeys]);

  const selectAllShapes = useCallback(() => {
    setSelectedKeys(new Set(shapes.map((s) => s.key)));
    setSelectedKey(shapes[0]?.key ?? null);
  }, [shapes]);

  const duplicateSelection = useCallback(() => {
    const keys = selectedKeys.size > 0 ? selectedKeys : (selectedKey ? new Set([selectedKey]) : new Set<string>());
    if (keys.size === 0) return;
    const clones: Shape[] = [];
    setShapes((prev) => {
      for (const s of prev) {
        if (!keys.has(s.key)) continue;
        const { id: _omitId, row_version: _rv, ...rest } = s;
        void _omitId; void _rv;
        clones.push({
          ...rest,
          key: `${s.key}-dup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          saved: false,
          points: s.points.map((p) => ({ x: p.x + 12, y: p.y + 12 })),
        });
      }
      return [...prev, ...clones];
    });
    if (clones.length > 0) {
      const cloneKeys = new Set(clones.map((c) => c.key));
      commandStackRef.current.record({
        id: `dup-${Date.now()}`,
        label: `Duplicate ${clones.length}`,
        undo: () => {
          setShapes((prev) => prev.filter((s) => !cloneKeys.has(s.key)));
          setCommandTick((t) => t + 1);
        },
        redo: () => {
          setShapes((prev) => [...prev, ...clones]);
          setCommandTick((t) => t + 1);
        },
      });
      setCommandTick((t) => t + 1);
    }
  }, [selectedKeys, selectedKey]);

  // Professional hotkeys: L/A/C tools, Space-hold pan, Z undo, Esc cancel, Enter finish.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = resolveCanvasHotkey(e);
      if (!action) return;
      e.preventDefault();

      switch (action.type) {
        case "tool":
          selectTool(action.tool);
          break;
        case "cancel":
          clearDrafts();
          break;
        case "finish":
          finishDraft();
          break;
        case "undo":
          undoLast();
          break;
        case "redo":
          redoLast();
          break;
        case "delete_selection":
          deleteSelection();
          break;
        case "select_all":
          selectAllShapes();
          break;
        case "duplicate":
          duplicateSelection();
          break;
        case "pan_hold_start":
          if (tool !== "pan") {
            toolBeforeSpacePan.current = tool;
            setTool("pan");
          }
          break;
        case "pan_hold_end": {
          const restore = toolBeforeSpacePan.current;
          toolBeforeSpacePan.current = null;
          if (restore) setTool(restore);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [tool, selectTool, clearDrafts, finishDraft, undoLast, redoLast, deleteSelection, selectAllShapes, duplicateSelection]);

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
      queryClient.setQueryData(takeoffQueryKeys.calibration(pageId), data.calibration);
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
    setDragState({ key: s.key, startClient: { x: e.clientX, y: e.clientY }, originalPoints: s.points, originalRowVersion: s.row_version });
  }, [tool]);

  const beginVertexDrag = useCallback((e: React.MouseEvent, s: Shape, vertexIndex: number) => {
    if (tool !== "pan" || (s.tool !== "length" && s.tool !== "area")) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedKey(s.key);
    setSelectedKeys(new Set([s.key]));
    setVertexDrag({
      key: s.key,
      vertexIndex,
      startClient: { x: e.clientX, y: e.clientY },
      originalPoints: s.points,
      originalRowVersion: s.row_version ?? null,
    });
  }, [tool]);

  const recomputeShapeQuantity = useCallback((toolKind: Shape["tool"], pts: Pt[], coordinateSpace: CoordinateSpace): number => {
    const display = toDisplayPoints(pts, coordinateSpace);
    if (toolKind === "count") return display.length || 1;
    if (toolKind === "length") return totalLen(display) * scale;
    return polygonArea(display) * scale * scale;
  }, [toDisplayPoints, scale]);

  const commitShapeDrag = useCallback(async (drag: { key: string; originalPoints: Pt[]; originalRowVersion: number }) => {
    const s = shapes.find((x) => x.key === drag.key);
    if (!s || !s.id) return;
    // No actual movement (e.g. a click that never crossed drag threshold) —
    // nothing to persist.
    if (JSON.stringify(s.points) === JSON.stringify(drag.originalPoints)) return;

    const previousPoints = drag.originalPoints;
    const nextPoints = s.points;

    const res = await fetch("/api/takeoff/canvas/manual", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: s.id, row_version: drag.originalRowVersion,
        quantity: s.quantity, unit: s.unit, cost_code: s.cost_code || null,
        geometry: { points: s.points, coordinate_space: "page_space", label: s.label, assembly_key: s.assembly_key },
      }),
    });

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      // Minimal conflict UX (STEP 2's required pair: reload server / discard
      // local) — a fuller side-by-side diff modal with "save as new object"
      // and "retry after review" is deferred, see REMAINING_RISKS.md.
      const reload = window.confirm(
        "This measurement was changed by someone else (or another tab) since you loaded it.\n\n" +
        "OK = reload the server's current version (discarding your drag)\n" +
        "Cancel = keep your local change (not saved yet — drag it again to retry)",
      );
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
      setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, points: drag.originalPoints } : x)));
      return;
    }

    const body = await res.json() as { manual_takeoff: { row_version: number }; quantity: number };
    setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, row_version: body.manual_takeoff.row_version, quantity: body.quantity } : x)));
    commandStackRef.current.record({
      id: `move-${s.id}-${Date.now()}`,
      label: "Move measurement",
      undo: async () => {
        const cur = shapes.find((x) => x.key === drag.key);
        if (!cur?.id || cur.row_version == null) {
          setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, points: previousPoints } : x)));
          return;
        }
        const undoRes = await fetch("/api/takeoff/canvas/manual", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: cur.id, row_version: cur.row_version,
            quantity: cur.quantity, unit: cur.unit, cost_code: cur.cost_code || null,
            geometry: { points: previousPoints, coordinate_space: "page_space", label: cur.label },
          }),
        });
        if (undoRes.ok) {
          const undoBody = await undoRes.json() as { manual_takeoff: { row_version: number }; quantity: number };
          setShapes((prev) => prev.map((x) => (x.key === drag.key
            ? { ...x, points: previousPoints, row_version: undoBody.manual_takeoff.row_version, quantity: undoBody.quantity }
            : x)));
        }
        setCommandTick((t) => t + 1);
      },
      redo: async () => {
        const cur = shapes.find((x) => x.key === drag.key);
        if (!cur?.id || cur.row_version == null) {
          setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, points: nextPoints } : x)));
          return;
        }
        const redoRes = await fetch("/api/takeoff/canvas/manual", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: cur.id, row_version: cur.row_version,
            quantity: cur.quantity, unit: cur.unit, cost_code: cur.cost_code || null,
            geometry: { points: nextPoints, coordinate_space: "page_space", label: cur.label },
          }),
        });
        if (redoRes.ok) {
          const redoBody = await redoRes.json() as { manual_takeoff: { row_version: number }; quantity: number };
          setShapes((prev) => prev.map((x) => (x.key === drag.key
            ? { ...x, points: nextPoints, row_version: redoBody.manual_takeoff.row_version, quantity: redoBody.quantity }
            : x)));
        }
        setCommandTick((t) => t + 1);
      },
    });
    setCommandTick((t) => t + 1);
  }, [shapes]);

  const commitVertexDrag = useCallback(async (drag: NonNullable<typeof vertexDrag>) => {
    const s = shapes.find((x) => x.key === drag.key);
    if (!s) return;
    if (JSON.stringify(s.points) === JSON.stringify(drag.originalPoints)) return;

    const quantity = recomputeShapeQuantity(s.tool, s.points, s.coordinateSpace);
    setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, quantity, saved: s.id ? x.saved : false } : x)));

    if (!s.id || drag.originalRowVersion == null) {
      commandStackRef.current.record({
        id: `vtx-local-${Date.now()}`,
        label: "Edit vertex",
        undo: () => {
          const q = recomputeShapeQuantity(s.tool, drag.originalPoints, s.coordinateSpace);
          setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, points: drag.originalPoints, quantity: q } : x)));
          setCommandTick((t) => t + 1);
        },
        redo: () => {
          const q = recomputeShapeQuantity(s.tool, s.points, s.coordinateSpace);
          setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, points: s.points, quantity: q } : x)));
          setCommandTick((t) => t + 1);
        },
      });
      setCommandTick((t) => t + 1);
      return;
    }

    const res = await fetch("/api/takeoff/canvas/manual", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: s.id,
        row_version: drag.originalRowVersion,
        quantity,
        unit: s.unit,
        cost_code: s.cost_code || null,
        geometry: { points: s.points, coordinate_space: s.coordinateSpace === "page_space" ? "page_space" : "page_space", label: s.label, assembly_key: s.assembly_key },
      }),
    });
    if (!res.ok) {
      if (res.status !== 409) {
        const err = await res.json().catch(() => ({}));
        alert(`Vertex edit failed: ${err.error ?? res.status}`);
      }
      setShapes((prev) => prev.map((x) => (x.key === drag.key ? { ...x, points: drag.originalPoints } : x)));
      return;
    }
    const body = await res.json() as { manual_takeoff: { row_version: number }; quantity: number };
    setShapes((prev) => prev.map((x) => (x.key === drag.key
      ? { ...x, row_version: body.manual_takeoff.row_version, quantity: body.quantity, saved: true }
      : x)));
    const revision = new PersistedGeometryRevision({
      id: s.id,
      rowVersion: body.manual_takeoff.row_version,
      unit: s.unit,
      costCode: s.cost_code || null,
      label: s.label,
      assemblyKey: s.assembly_key,
      before: {
        points: drag.originalPoints,
        quantity: recomputeShapeQuantity(s.tool, drag.originalPoints, s.coordinateSpace),
      },
      after: { points: s.points, quantity: body.quantity },
    });
    const applyRevision = async (patch: ReturnType<PersistedGeometryRevision["undoBody"]>, points: Pt[]) => {
      const undoRes = await fetch("/api/takeoff/canvas/manual", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!undoRes.ok) return;
      const undoBody = await undoRes.json() as { manual_takeoff: { row_version: number }; quantity: number };
      revision.accept(undoBody.manual_takeoff.row_version);
      setShapes((prev) => prev.map((x) => (x.key === drag.key
        ? { ...x, points, row_version: undoBody.manual_takeoff.row_version, quantity: undoBody.quantity, saved: true }
        : x)));
      setCommandTick((t) => t + 1);
    };
    commandStackRef.current.record({
      id: `vtx-${s.id}-${Date.now()}`,
      label: "Edit vertex",
      undo: () => applyRevision(revision.undoBody(), revision.undoBody().geometry.points),
      redo: () => applyRevision(revision.redoBody(), revision.redoBody().geometry.points),
    });
    setCommandTick((t) => t + 1);
  }, [shapes, recomputeShapeQuantity]);

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startClient.x;
      const dy = e.clientY - dragState.startClient.y;
      setShapes((prev) => prev.map((s) => {
        if (s.key !== dragState.key) return s;
        // Drag delta is measured in CURRENT-render screen pixels (raw
        // clientX/Y deltas) — apply it in display space, then convert back
        // to the shape's own storage space, mirroring the
        // toDisplayPoints/toPersistedPoints pattern used everywhere else.
        const originalDisplay = toDisplayPoints(dragState.originalPoints, s.coordinateSpace);
        const movedDisplay = originalDisplay.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        const movedStorage = s.coordinateSpace === "page_space" ? pointsToPageSpace(movedDisplay, renderScale) : movedDisplay;
        return { ...s, points: movedStorage };
      }));
    };
    const onUp = () => { void commitShapeDrag(dragState); setDragState(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [dragState, renderScale, commitShapeDrag, toDisplayPoints]);

  useEffect(() => {
    if (!vertexDrag) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - vertexDrag.startClient.x;
      const dy = e.clientY - vertexDrag.startClient.y;
      setShapes((prev) => prev.map((s) => {
        if (s.key !== vertexDrag.key) return s;
        const originalDisplay = toDisplayPoints(vertexDrag.originalPoints, s.coordinateSpace);
        const movedDisplay = originalDisplay.map((p, i) => (
          i === vertexDrag.vertexIndex ? { x: p.x + dx, y: p.y + dy } : p
        ));
        const movedStorage = s.coordinateSpace === "page_space" ? pointsToPageSpace(movedDisplay, renderScale) : movedDisplay;
        const quantity = recomputeShapeQuantity(s.tool, movedStorage, s.coordinateSpace);
        return { ...s, points: movedStorage, quantity };
      }));
    };
    const onUp = () => { void commitVertexDrag(vertexDrag); setVertexDrag(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [vertexDrag, renderScale, commitVertexDrag, toDisplayPoints, recomputeShapeQuantity]);

  async function saveAllUnsaved() {
    const unsaved = shapes.filter((s) => !s.saved);
    const unsavedRuns = utilityRuns.filter((r) => !r.saved);
    const unsavedTopo = topoNodes.filter((n) => !n.saved);
    const unsavedAreas = areaBounds.filter((a) => !a.saved);
    const unsavedWalls = wallRuns.filter((w) => !w.saved);
    if (unsaved.length === 0 && unsavedRuns.length === 0 && unsavedTopo.length === 0 && unsavedAreas.length === 0 && unsavedWalls.length === 0) return;
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
          layer_id: s.layer_id ?? activeLayerId ?? null,
          geometry: {
            points: toPersistedPoints(s.points, s.coordinateSpace),
            coordinate_space: "page_space",
            page_number: pageNumber,
            label: s.label,
            assembly_key: s.assembly_key,
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

      if (unsavedWalls.length > 0) {
        const items = unsavedWalls.map((w) => ({
          project_id: projectId,
          page_id: pageId,
          length_lf: Number(w.length_lf.toFixed(2)),
          height_ft: w.height_ft,
          thickness_in: w.thickness_in,
          rebar_size: w.rebar_size ?? null,
          rebar_spacing_inches: w.rebar_spacing_inches ?? null,
          client_key: w.key,
          geometry: { points: toPersistedPoints(w.points, w.coordinateSpace), coordinate_space: "page_space", page_number: pageNumber },
        }));
        requests.push(fetch("/api/takeoff/canvas/wall", {
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
        setWallRuns((prev) => prev.map((w) => (w.saved ? w : { ...w, points: toPersistedPoints(w.points, w.coordinateSpace), coordinateSpace: "page_space", saved: true })));
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
  function updateShapeProps(key: string, patch: Partial<Pick<Shape, "label" | "layer_id" | "cost_code" | "assembly_key">>) {
    setShapes((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch, saved: false } : s)));
  }
  function removeShape(key: string) {
    void deleteShapesByKeys(new Set([key]));
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

  const qtyLegend = useMemo(
    () => buildQuantitySummary(shapes.map((s) => ({
      tool: s.tool,
      cost_code: s.cost_code,
      quantity: s.quantity,
      unit: s.unit,
    }))),
    [shapes],
  );

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
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(["pan", "calibrate", "count", "length", "area", "utility_pipe", "spot_elevation", "contour_line", "civil_area_bounds"] as Tool[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => selectTool(t)}
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
            <p className="hidden px-1 text-[9px] font-mono uppercase tracking-widest text-white/30 sm:block">
              {CANVAS_HOTKEY_HINT}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/40">
            {priorUrl && (
              <button
                type="button"
                onClick={() => setShowPrior((on) => !on)}
                className={`rounded-full border px-2 py-0.5 normal-case tracking-normal ${
                  showPrior
                    ? "border-red-400/70 bg-red-500/20 text-red-200"
                    : "border-white/10 text-white/60 hover:text-white hover:bg-white/[0.06]"
                }`}
                title="Ghost the previous revision of this sheet in red"
              >
                {showPrior ? `Hide ${priorLabel ?? "prior"}` : `Ghost ${priorLabel ?? "prior rev"}`}
              </button>
            )}
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
                <button
                  type="button"
                  onClick={() => {
                    // Existing saved measurements each store their OWN
                    // computed quantity independently — recalibrating never
                    // retroactively changes them (approved quantities can
                    // never silently change, STEP 5). It only changes what
                    // scale NEW draws use going forward, so the confirmation
                    // here is about that distinction, not a batch recompute.
                    if (!window.confirm(
                      "Recalibrating sets the scale for NEW measurements drawn from now on.\n\n" +
                      "Existing saved measurements keep their already-computed quantities unchanged — recalibration never silently alters them.\n\nContinue?",
                    )) return;
                    selectTool("calibrate");
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
        {tool === "length" && (
          <div className="flex items-center gap-3 border-t border-white/5 bg-white/[0.02] px-4 py-2">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/60">
              <input
                type="checkbox"
                checked={wallMode}
                onChange={(e) => setWallMode(e.target.checked)}
                className="accent-[#CCFF00]"
              />
              Expand as wall
            </label>
            <span className="text-[10px] text-white/40">Draw the centerline, then set height and thickness. Concrete, formwork, and rebar are calculated from that line.</span>
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
          <canvas
            ref={priorCanvasRef}
            aria-hidden={!showPrior}
            className={`pointer-events-none absolute left-0 top-0 rounded-md mix-blend-multiply ${showPrior ? "opacity-55" : "hidden"}`}
            style={showPrior ? { filter: "sepia(1) saturate(8) hue-rotate(-30deg)" } : undefined}
          />
          {renderSize && (
            <svg
              width={renderSize.w}
              height={renderSize.h}
              viewBox={`0 0 ${renderSize.w} ${renderSize.h}`}
              className={`absolute inset-0 select-none ${tool === "pan" ? "cursor-grab" : "cursor-crosshair"}`}
              onClick={onCanvasClick}
              onMouseMove={(e) => {
                onCanvasMouseMove(e);
                if (marquee && tool === "pan") {
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  setMarquee((m) => m ? { ...m, x1: e.clientX - rect.left, y1: e.clientY - rect.top } : m);
                }
              }}
              onMouseLeave={() => { onCanvasMouseLeave(); setMarquee(null); }}
              onDoubleClick={finishDraft}
              onMouseDown={(e) => {
                if (tool !== "pan" || !e.shiftKey) return;
                const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                setMarquee({ x0: x, y0: y, x1: x, y1: y });
              }}
              onMouseUp={() => {
                if (!marquee) return;
                const xMin = Math.min(marquee.x0, marquee.x1);
                const xMax = Math.max(marquee.x0, marquee.x1);
                const yMin = Math.min(marquee.y0, marquee.y1);
                const yMax = Math.max(marquee.y0, marquee.y1);
                const hit = new Set<string>();
                for (const s of shapes) {
                  if (s.layer_id && hiddenLayerIds.has(s.layer_id)) continue;
                  const pts = toDisplayPoints(s.points, s.coordinateSpace);
                  if (pts.some((p) => p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax)) {
                    hit.add(s.key);
                  }
                }
                if (hit.size > 0) {
                  setSelectedKeys(hit);
                  setSelectedKey([...hit][0] ?? null);
                }
                setMarquee(null);
              }}
            >
              {/* Committed shapes (layer visibility filters display only — quantities unchanged) */}
              {shapes.filter((s) => !s.layer_id || !hiddenLayerIds.has(s.layer_id)).map((s) => {
                const isSel = selectedKeys.has(s.key) || s.key === selectedKey;
                const color = s.tool === "count" ? "#CCFF00" : s.tool === "length" ? "#00D2FF" : "#f97316";
                const sPts = toDisplayPoints(s.points, s.coordinateSpace);
                const cursorClass = tool === "pan" && s.saved && s.id ? "cursor-move" : "";
                if (s.tool === "count") {
                  const p = sPts[0];
                  return (
                    <g key={s.key} className={cursorClass} onClick={(e) => { e.stopPropagation(); toggleSelectKey(s.key, e.shiftKey || e.metaKey || e.ctrlKey); }} onMouseDown={(e) => beginShapeDrag(e, s)}>
                      <circle cx={p.x} cy={p.y} r={isSel ? 9 : 7} fill={color} stroke="#000" strokeWidth={2} />
                    </g>
                  );
                }
                if (s.tool === "length") {
                  const d = sPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
                  return (
                    <g key={s.key} className={cursorClass} onClick={(e) => { e.stopPropagation(); toggleSelectKey(s.key, e.shiftKey || e.metaKey || e.ctrlKey); }} onMouseDown={(e) => beginShapeDrag(e, s)}>
                      <path d={d} stroke={color} strokeWidth={isSel ? 4 : 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      {isSel && sPts.map((p, i) => (
                        <circle
                          key={`v-${i}`}
                          cx={p.x}
                          cy={p.y}
                          r={5}
                          fill="#fff"
                          stroke={color}
                          strokeWidth={1.5}
                          className="cursor-nesw-resize"
                          onMouseDown={(e) => beginVertexDrag(e, s, i)}
                        />
                      ))}
                    </g>
                  );
                }
                // area
                const d = sPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
                return (
                  <g key={s.key} className={cursorClass} onClick={(e) => { e.stopPropagation(); toggleSelectKey(s.key, e.shiftKey || e.metaKey || e.ctrlKey); }} onMouseDown={(e) => beginShapeDrag(e, s)}>
                    <path d={d} fill={`${color}44`} stroke={color} strokeWidth={isSel ? 3 : 2} />
                    {isSel && sPts.map((p, i) => (
                      <circle
                        key={`v-${i}`}
                        cx={p.x}
                        cy={p.y}
                        r={5}
                        fill="#fff"
                        stroke={color}
                        strokeWidth={1.5}
                        className="cursor-nesw-resize"
                        onMouseDown={(e) => beginVertexDrag(e, s, i)}
                      />
                    ))}
                  </g>
                );
              })}
              {marquee && (
                <rect
                  x={Math.min(marquee.x0, marquee.x1)}
                  y={Math.min(marquee.y0, marquee.y1)}
                  width={Math.abs(marquee.x1 - marquee.x0)}
                  height={Math.abs(marquee.y1 - marquee.y0)}
                  fill="rgba(204,255,0,0.12)"
                  stroke="#CCFF00"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}
              {/* Non-quantity markups */}
              {markups.map((m) => {
                const pts = m.geometry?.points ?? [];
                const p0 = pts[0];
                if (!p0) return null;
                return (
                  <g key={m.id} pointerEvents="none">
                    <circle cx={p0.x} cy={p0.y} r={5} fill={m.color} opacity={0.85} />
                    <text x={p0.x + 8} y={p0.y + 4} fill={m.color} fontSize={11} fontFamily="monospace">
                      {m.label ?? m.geometry?.text ?? "note"}
                    </text>
                  </g>
                );
              })}

              {/* Committed utility pipe runs */}
              {utilityRuns.map((u) => {
                const uPts = toDisplayPoints(u.points, u.coordinateSpace);
                const d = uPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
                return (
                  <g key={u.key}>
                    <path d={d} stroke="#a855f7" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 4" />
                    {uPts.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#a855f7" stroke="#000" strokeWidth={1} />
                    ))}
                  </g>
                );
              })}

              {wallRuns.map((w) => {
                const wPts = toDisplayPoints(w.points, w.coordinateSpace);
                const d = wPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
                return (
                  <g key={w.key}>
                    <path d={d} stroke="#f59e0b" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    {wPts.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#f59e0b" stroke="#000" strokeWidth={1} />
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

              {/* Committed topo nodes (contours + spot elevations) */}
              {topoNodes.map((n) => {
                const nPts = toDisplayPoints(n.points, n.coordinateSpace);
                if (n.node_type === "spot_elevation") {
                  const p = nPts[0];
                  return (
                    <g key={n.key}>
                      <line x1={p.x - 7} y1={p.y} x2={p.x + 7} y2={p.y} stroke="#22d3ee" strokeWidth={2} />
                      <line x1={p.x} y1={p.y - 7} x2={p.x} y2={p.y + 7} stroke="#22d3ee" strokeWidth={2} />
                      <circle cx={p.x} cy={p.y} r={2} fill="#22d3ee" />
                      <text x={p.x + 10} y={p.y - 8} fontSize={11} fill="#22d3ee" fontFamily="monospace">{n.elevation.toFixed(2)}&apos;</text>
                    </g>
                  );
                }
                const d = nPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
                const mid = nPts[Math.floor(nPts.length / 2)];
                return (
                  <g key={n.key}>
                    <path d={d} stroke="#22d3ee" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    {mid && <text x={mid.x + 6} y={mid.y - 6} fontSize={11} fill="#22d3ee" fontFamily="monospace">{n.elevation.toFixed(2)}&apos;</text>}
                  </g>
                );
              })}

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

              {/* Committed area bounds polygons */}
              {areaBounds.map((a) => {
                const d = toDisplayPoints(a.points, a.coordinateSpace).map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
                return (
                  <g key={a.key}>
                    <path d={d} fill="#f9731633" stroke="#f97316" strokeWidth={2} />
                  </g>
                );
              })}

              {/* Draft (in-progress) area bounds polygon */}
              {tool === "civil_area_bounds" && areaDraftPts.length > 0 && (
                <g>
                  <path
                    d={areaDraftPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + (areaDraftPts.length >= 3 ? " Z" : "")}
                    stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" fill="#f9731622"
                  />
                  {areaDraftPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#f97316" strokeWidth={1.5} />
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

              {/* Magnetic snap target — green ring when cursor locks to a vector vertex */}
              {SNAP_TOOLS.has(tool) && snapTarget && (
                <g pointerEvents="none">
                  <circle
                    cx={snapTarget.point.x}
                    cy={snapTarget.point.y}
                    r={10}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={2}
                    opacity={0.95}
                  />
                  <circle
                    cx={snapTarget.point.x}
                    cy={snapTarget.point.y}
                    r={4}
                    fill="#22c55e"
                    stroke="#052e16"
                    strokeWidth={1}
                    opacity={0.85}
                  />
                  <line
                    x1={snapTarget.point.x - 14}
                    y1={snapTarget.point.y}
                    x2={snapTarget.point.x + 14}
                    y2={snapTarget.point.y}
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    opacity={0.7}
                  />
                  <line
                    x1={snapTarget.point.x}
                    y1={snapTarget.point.y - 14}
                    x2={snapTarget.point.x}
                    y2={snapTarget.point.y + 14}
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    opacity={0.7}
                  />
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
            onSnapPointsChange={setSnapPoints}
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
              coordinateSpace: "legacy_pixel",
              quantity: vi.quantity,
              unit: (vi.unit === "EA" || vi.unit === "SF" || vi.unit === "LF") ? vi.unit as "EA"|"SF"|"LF" : "EA",
              cost_code: vi.cost_code,
              saved: true,
            }]);
          }}
        />
        <div className="border-b border-white/10 px-4 py-3 space-y-3">
          <TakeoffLayersPanel
            projectId={projectId}
            activeLayerId={activeLayerId}
            onActiveLayerChange={setActiveLayerId}
            onVisibilityChange={(layers) => {
              setHiddenLayerIds(new Set(layers.filter((l) => !l.visible).map((l) => l.id)));
            }}
          />
          <PlaceAssemblyPanel
            onPlace={(rows) => {
              setShapes((prev) => [
                ...prev,
                ...rows.map((r, i) => ({
                  key: `asm-${r.meta.assembly_group}-${i}`,
                  tool: (r.unit === "LF" ? "length" : r.unit === "SF" ? "area" : "count") as Shape["tool"],
                  points: [{ x: 40 + i * 14, y: 40 + i * 14 }],
                  coordinateSpace: "legacy_pixel" as const,
                  quantity: r.quantity,
                  unit: r.unit,
                  cost_code: r.cost_code,
                  layer_id: activeLayerId,
                  saved: false,
                })),
              ]);
            }}
          />
          <button
            type="button"
            onClick={() => setMarkupMode((v) => !v)}
            className={`w-full rounded-lg border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest ${
              markupMode
                ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
                : "border-white/10 text-white/50 hover:text-white"
            }`}
            title="Text markups never sync to estimates"
          >
            {markupMode ? "Markup on — click sheet" : "Markup (non-qty)"}
          </button>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Measurements</div>
            <a
              href={`/api/takeoff/export?project_id=${encodeURIComponent(projectId)}&format=csv`}
              className="text-[10px] font-mono text-[#CCFF00]/80 hover:text-[#CCFF00]"
            >
              Export CSV
            </a>
          </div>
          {selectedKey && (() => {
            const sel = shapes.find((s) => s.key === selectedKey);
            if (!sel) return null;
            return (
              <div className="mt-2 space-y-1.5 rounded border border-white/10 bg-black/40 p-2">
                <div className="text-[9px] uppercase tracking-widest text-white/35">Properties</div>
                <input
                  type="text"
                  placeholder="Label"
                  value={sel.label ?? ""}
                  onChange={(e) => updateShapeProps(sel.key, { label: e.target.value })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white focus:border-[#CCFF00] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="NN-NN-NN cost code"
                  value={sel.cost_code ?? ""}
                  onChange={(e) => updateShapeProps(sel.key, { cost_code: e.target.value })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-white focus:border-[#CCFF00] focus:outline-none"
                />
                <select
                  value={sel.layer_id ?? ""}
                  onChange={(e) => updateShapeProps(sel.key, { layer_id: e.target.value || null })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white focus:border-[#CCFF00] focus:outline-none"
                >
                  <option value="">Unassigned layer</option>
                  {layerOptions.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Assembly group key"
                  value={sel.assembly_key ?? ""}
                  onChange={(e) => updateShapeProps(sel.key, { assembly_key: e.target.value || null })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-white focus:border-[#CCFF00] focus:outline-none"
                />
              </div>
            );
          })()}
          <div className="mt-1 text-sm font-semibold">
            {shapes.length} item{shapes.length === 1 ? "" : "s"}
            <span className="text-white/40 font-normal"> · {totals.count} EA · {totals.len.toFixed(1)} LF · {totals.area.toFixed(1)} SF</span>
          </div>
          {qtyLegend.length > 0 && (
            <div className="mt-2 max-h-28 space-y-0.5 overflow-y-auto rounded border border-white/5 bg-black/30 p-2">
              <div className="text-[9px] uppercase tracking-widest text-white/35">Qty by CSI</div>
              {qtyLegend.map((row) => (
                <div key={`${row.costCode}-${row.unit}-${row.tool}`} className="flex justify-between gap-2 font-mono text-[10px] text-white/70">
                  <span>{row.costCode}</span>
                  <span>{row.quantity.toFixed(2)} {row.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {shapes.length === 0 && (
            <div className="text-xs text-white/40 px-2 py-4 text-center">
              No measurements yet. Pick a tool, click the sheet.
            </div>
          )}
          {shapes.map((s) => {
            const color = s.tool === "count" ? "text-[#CCFF00]" : s.tool === "length" ? "text-[#00D2FF]" : "text-orange-400";
            const isSel = selectedKeys.has(s.key) || s.key === selectedKey;
            return (
              <div
                key={s.key}
                onClick={(e) => toggleSelectKey(s.key, e.shiftKey || e.metaKey || e.ctrlKey)}
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

        {wallRuns.length > 0 && (
          <div className="border-t border-white/10 px-3 py-2 space-y-1.5 max-h-[35vh] overflow-y-auto">
            <div className="px-1 text-[10px] uppercase tracking-widest font-mono text-amber-400">
              Walls · {wallRuns.length}
            </div>
            {wallRuns.map((w) => {
              const recipe = wallRecipeLines({
                name: "Wall",
                length_lf: w.length_lf,
                height_ft: w.height_ft,
                thickness_in: w.thickness_in,
                rebar_size: w.rebar_size,
                rebar_spacing_inches: w.rebar_spacing_inches,
              });
              return (
                <div key={w.key} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-mono">
                      {w.length_lf.toFixed(1)} <span className="text-white/40">LF</span>
                      <span className="text-white/40 text-xs"> · {w.height_ft}&apos; H · {w.thickness_in}&quot;</span>
                    </div>
                    <button type="button" onClick={() => setWallRuns((prev) => prev.filter((x) => x.key !== w.key))} className="text-[10px] text-white/30 hover:text-red-400">✕</button>
                  </div>
                  <div className="mt-1 space-y-0.5 text-[10px] font-mono text-white/50">
                    {recipe.map((line) => (
                      <div key={line.csi_code} className="flex justify-between gap-2">
                        <span>{line.label}</span>
                        <span>{line.quantity} {line.unit}</span>
                      </div>
                    ))}
                  </div>
                  {w.saved && <span className="text-[9px] uppercase tracking-widest font-mono text-white/40">Saved</span>}
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
              || ([...shapes, ...utilityRuns, ...topoNodes, ...areaBounds, ...wallRuns].every((x) => x.saved))
              || (shapes.length === 0 && utilityRuns.length === 0 && topoNodes.length === 0 && areaBounds.length === 0 && wallRuns.length === 0)}
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
      {wallModalPts && (
        <WallRunModal
          previewLengthLf={totalLen(wallModalPts) * scale}
          onCancel={() => { setWallModalPts(null); setDraftPoints([]); }}
          onSubmit={commitWall}
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
          <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Recipe</div>
          {utilityRecipeFromRun({
            name: systemType,
            system: systemType,
            diameter_in: diameterIn,
            length_lf: previewLengthLf,
            trench_width_ft: trenchWidthFt,
          }).map((line) => (
            <div key={`${line.csi_code}-${line.label}`} className="flex justify-between gap-3">
              <span>{line.label}</span>
              <span className="font-mono">{line.quantity.toLocaleString()} {line.unit}</span>
            </div>
          ))}
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

function WallRunModal({
  previewLengthLf, onCancel, onSubmit,
}: {
  previewLengthLf: number;
  onCancel: () => void;
  onSubmit: (inputs: WallInputs) => void;
}) {
  const [heightFt, setHeightFt] = useState(8);
  const [thicknessIn, setThicknessIn] = useState(8);
  const [rebarSize, setRebarSize] = useState<RebarSize | "">("#4");
  const [spacingIn, setSpacingIn] = useState(18);
  const recipe = wallRecipeLines({
    name: "Wall",
    length_lf: previewLengthLf,
    height_ft: heightFt,
    thickness_in: thicknessIn,
    rebar_size: rebarSize || undefined,
    rebar_spacing_inches: rebarSize ? spacingIn : undefined,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0E0F12] p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">Configure Wall</h3>
          <button type="button" onClick={onCancel} className="text-white/40 hover:text-white">✕</button>
        </div>
        <p className="mb-4 text-[11px] text-white/50">
          Centerline: <span className="font-mono text-amber-400">{previewLengthLf.toFixed(1)} LF</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Height (ft)</span>
            <input type="number" min={0.5} step={0.5} value={heightFt} onChange={(e) => setHeightFt(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Thickness (in)</span>
            <input type="number" min={1} step={1} value={thicknessIn} onChange={(e) => setThicknessIn(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Rebar size</span>
            <select value={rebarSize} onChange={(e) => setRebarSize(e.target.value as RebarSize | "")}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]">
              <option value="">None</option>
              {(["#3", "#4", "#5", "#6", "#7", "#8"] as RebarSize[]).map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Spacing (in)</span>
            <input type="number" min={1} step={1} value={spacingIn} onChange={(e) => setSpacingIn(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#CCFF00]" />
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-white/70">
          <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Recipe</div>
          {recipe.map((line) => (
            <div key={line.csi_code} className="flex justify-between gap-3">
              <span>{line.label}</span>
              <span className="font-mono">{line.quantity.toLocaleString()} {line.unit}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white">Cancel</button>
          <button
            type="button"
            onClick={() => onSubmit({
              height_ft: heightFt,
              thickness_in: thicknessIn,
              rebar_size: rebarSize || undefined,
              rebar_spacing_inches: rebarSize ? spacingIn : undefined,
            })}
            className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85"
          >
            Add Wall
          </button>
        </div>
      </div>
    </div>
  );
}
