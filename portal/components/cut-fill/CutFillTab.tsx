"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";
import HeatmapCanvas from "./HeatmapCanvas";
import { parseSurfaceCsv } from "@/lib/cutfill/sampling";

interface SurfaceSummary {
  id: string;
  name: string;
  type: "existing" | "proposed";
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  } | null;
  point_count: number;
  uploaded_at: string;
}
interface GridData {
  origin: { x: number; y: number };
  resolution_ft: number;
  rows: number;
  cols: number;
  min_delta: number;
  max_delta: number;
  delta: number[][];
}
interface ComputeSummary {
  cut_cy: number;
  fill_cy: number;
  net_cy: number;
  grid_resolution_ft: number;
  cells: number;
}
interface CutFillTabProps {
  projectId: string;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
}

export default function CutFillTab({ projectId }: CutFillTabProps) {
  const [surfaces, setSurfaces] = useState<SurfaceSummary[]>([]);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [proposedId, setProposedId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<number>(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grid, setGrid] = useState<GridData | null>(null);
  const [summary, setSummary] = useState<ComputeSummary | null>(null);
  const existingInput = useRef<HTMLInputElement | null>(null);
  const proposedInput = useRef<HTMLInputElement | null>(null);

  const loadSurfaces = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/cut-fill/surfaces?project_id=${encodeURIComponent(projectId)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load cut/fill surfaces. Refresh the page and try again.");
      const list: SurfaceSummary[] = j.surfaces ?? [];
      setSurfaces(list);
      // auto-pick most recent of each type
      const ex = list.find((s) => s.type === "existing");
      const pr = list.find((s) => s.type === "proposed");
      setExistingId((cur) => cur ?? ex?.id ?? null);
      setProposedId((cur) => cur ?? pr?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useProjectSyncRefresh(loadSurfaces);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSurfaces();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSurfaces]);

  const uploadCsv = useCallback(
    async (file: File, type: "existing" | "proposed") => {
      setError(null);
      setBusy(`Uploading ${type} surface...`);
      try {
        const text = await file.text();
        const points = parseSurfaceCsv(text);
        if (points.length < 3) throw new Error("CSV must contain at least 3 valid x,y,z rows");
        const name = file.name.replace(/\.[^.]+$/, "");
        const r = await fetch("/api/cut-fill/surfaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project_id: projectId, name, type, points }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Upload failed");
        await loadSurfaces();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [projectId, loadSurfaces]
  );

  const deleteSurface = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const r = await fetch(
          `/api/cut-fill/surfaces/${id}?project_id=${encodeURIComponent(projectId)}`,
          { method: "DELETE" }
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not delete that surface. Try again in a moment.");
        if (existingId === id) setExistingId(null);
        if (proposedId === id) setProposedId(null);
        await loadSurfaces();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [projectId, existingId, proposedId, loadSurfaces]
  );

  const compute = useCallback(async () => {
    if (!existingId || !proposedId) {
      setError("Pick both an existing and a proposed surface");
      return;
    }
    setError(null);
    setBusy("Computing volumes...");
    try {
      const r = await fetch("/api/cut-fill/compute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          existing_surface_id: existingId,
          proposed_surface_id: proposedId,
          grid_resolution_ft: resolution,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Compute failed");
      setGrid(j.grid as GridData);
      setSummary(j.summary as ComputeSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [projectId, existingId, proposedId, resolution]);

  const existingSurfaces = surfaces.filter((s) => s.type === "existing");
  const proposedSurfaces = surfaces.filter((s) => s.type === "proposed");

  return (
    <div className="space-y-6 text-neutral-100">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Cut / Fill Earthwork</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Upload existing and proposed grade points as CSV (columns: x,y,z or northing,easting,elevation).
          We interpolate delta-z on a uniform grid and tally cut/fill volumes.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(["existing", "proposed"] as const).map((type) => {
          const ref = type === "existing" ? existingInput : proposedInput;
          return (
            <div
              key={type}
              className="rounded-md border border-neutral-800 bg-neutral-950/60 p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
                  {type} surface
                </h3>
                <span className="text-xs text-neutral-500">
                  {type === "existing" ? existingSurfaces.length : proposedSurfaces.length} loaded
                </span>
              </div>
              <button
                type="button"
                onClick={() => ref.current?.click()}
                className="w-full rounded-md border border-dashed border-neutral-700 px-4 py-6 text-sm text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
              >
                Click to upload CSV
              </button>
              <input
                ref={ref}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadCsv(f, type);
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Compute volumes
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Existing surface</span>
            <select
              value={existingId ?? ""}
              onChange={(e) => setExistingId(e.target.value || null)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            >
              <option value="">- select -</option>
              {existingSurfaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.point_count} pts)
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Proposed surface</span>
            <select
              value={proposedId ?? ""}
              onChange={(e) => setProposedId(e.target.value || null)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            >
              <option value="">- select -</option>
              {proposedSurfaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.point_count} pts)
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">
              Grid resolution: <span className="text-neutral-200">{resolution} ft</span>
            </span>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={resolution}
              onChange={(e) => setResolution(parseInt(e.target.value, 10))}
              className="w-full"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={compute}
            disabled={!existingId || !proposedId || busy !== null}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-neutral-700"
          >
            {busy ?? "Compute cut/fill"}
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-md border border-red-900/60 bg-red-950/30 p-4">
            <div className="text-xs uppercase tracking-wider text-red-300">Cut</div>
            <div className="mt-1 text-2xl font-semibold text-red-200">{fmt(summary.cut_cy)} CY</div>
          </div>
          <div className="rounded-md border border-sky-900/60 bg-sky-950/30 p-4">
            <div className="text-xs uppercase tracking-wider text-sky-300">Fill</div>
            <div className="mt-1 text-2xl font-semibold text-sky-200">{fmt(summary.fill_cy)} CY</div>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="text-xs uppercase tracking-wider text-neutral-400">Net (Fill âˆ’ Cut)</div>
            <div
              className={`mt-1 text-2xl font-semibold ${
                summary.net_cy >= 0 ? "text-sky-200" : "text-red-200"
              }`}
            >
              {summary.net_cy >= 0 ? "+" : ""}
              {fmt(summary.net_cy)} CY
            </div>
          </div>
        </div>
      )}

      <HeatmapCanvas grid={grid} />

      <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Surfaces
        </h3>
        {surfaces.length === 0 ? (
          <p className="text-sm text-neutral-500">No surfaces uploaded yet. Add an Existing and Proposed surface above to compute cut and fill.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {surfaces.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-neutral-100">{s.name}</div>
                  <div className="text-xs text-neutral-500">
                    {s.type} • {s.point_count} points •{" "}
                    {new Date(s.uploaded_at).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteSurface(s.id)}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 transition hover:border-red-700 hover:text-red-300"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
