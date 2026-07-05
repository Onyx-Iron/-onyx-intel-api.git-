"use client";

import { useEffect, useRef } from "react";

interface GridData {
  rows: number;
  cols: number;
  min_delta: number;
  max_delta: number;
  delta: number[][];
}

interface HeatmapCanvasProps {
  grid: GridData | null;
  height?: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Returns [r,g,b] for a Δz value: red = cut (negative), blue = fill (positive), white at 0.
function colorFor(delta: number, scale: number): [number, number, number] {
  if (!Number.isFinite(delta) || scale <= 0) return [245, 245, 245];
  const t = Math.max(-1, Math.min(1, delta / scale));
  if (t < 0) {
    // white → red
    const k = -t;
    return [255, Math.round(lerp(255, 60, k)), Math.round(lerp(255, 60, k))];
  }
  // white → blue
  return [Math.round(lerp(255, 60, t)), Math.round(lerp(255, 100, t)), Math.round(lerp(255, 220, t))];
}

export default function HeatmapCanvas({ grid, height = 420 }: HeatmapCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!grid || grid.rows === 0 || grid.cols === 0) {
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#666";
      ctx.font = "14px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No grid computed yet", w / 2, h / 2);
      return;
    }

    const scale = Math.max(Math.abs(grid.min_delta), Math.abs(grid.max_delta), 0.01);
    const cellW = w / grid.cols;
    const cellH = h / grid.rows;

    // Canvas y grows downward; flip so larger Y (north) renders at top.
    for (let r = 0; r < grid.rows; r++) {
      const row = grid.delta[r];
      const py = h - (r + 1) * cellH;
      for (let c = 0; c < grid.cols; c++) {
        const [rr, gg, bb] = colorFor(row[c], scale);
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.fillRect(Math.floor(c * cellW), Math.floor(py), Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
      }
    }
  }, [grid]);

  return (
    <div className="w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
      <canvas
        ref={ref}
        width={800}
        height={height}
        style={{ width: "100%", height, imageRendering: "pixelated", display: "block" }}
      />
      {grid && (
        <div className="flex items-center justify-between px-3 py-2 text-xs text-neutral-400">
          <span>
            Min Δz: <span className="text-red-400">{grid.min_delta.toFixed(2)} ft</span>
          </span>
          <span className="text-neutral-500">
            {grid.cols} × {grid.rows} cells
          </span>
          <span>
            Max Δz: <span className="text-sky-400">{grid.max_delta.toFixed(2)} ft</span>
          </span>
        </div>
      )}
    </div>
  );
}
