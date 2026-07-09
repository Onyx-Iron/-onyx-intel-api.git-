import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import {
  buildGrid,
  computeVolumes,
  idwInterpolate,
  type Bounds,
  type Point3,
} from "@/lib/cutfill/sampling";
import type { Json } from "@/lib/supabase/types";

// Each grid cell runs two O(points) IDW scans (existing + proposed surface),
// so cost is ~ cells * points. With grid_resolution_ft allowed down to 0.5ft,
// a modest 1000x1000ft site was previously able to produce a 4M-cell grid
// with no cap and no maxDuration, i.e. an unbounded synchronous computation
// on Vercel's default (low) serverless timeout. Cap total cells instead.
export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_GRID_CELLS = 250_000;

interface ComputeBody {
  project_id?: string;
  existing_surface_id?: string;
  proposed_surface_id?: string;
  grid_resolution_ft?: number;
}

interface SurfaceRow {
  id: string;
  points: unknown;
  bounds: unknown;
}

function asPoints(value: unknown): Point3[] {
  if (!Array.isArray(value)) return [];
  const out: Point3[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { x?: unknown; y?: unknown; z?: unknown };
    const x = typeof p.x === "number" ? p.x : NaN;
    const y = typeof p.y === "number" ? p.y : NaN;
    const z = typeof p.z === "number" ? p.z : NaN;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) out.push({ x, y, z });
  }
  return out;
}

function asBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== "object") return null;
  const b = value as Record<string, unknown>;
  const keys = ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = b[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out as unknown as Bounds;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as ComputeBody;
    const { project_id, existing_surface_id, proposed_surface_id } = body;
    const gridRes = Number(body.grid_resolution_ft ?? 5);

    if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    if (!existing_surface_id || !proposed_surface_id) {
      return NextResponse.json(
        { error: "existing_surface_id and proposed_surface_id are required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(gridRes) || gridRes < 0.5 || gridRes > 200) {
      return NextResponse.json({ error: "grid_resolution_ft must be between 0.5 and 200" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data: rows, error } = await db
      .from("cut_fill_surfaces")
      .select("id,points,bounds,type")
      .eq("tenant_id", tenantId)
      .eq("project_id", project_id)
      .in("id", [existing_surface_id, proposed_surface_id]);

    if (error) return NextResponse.json({ error: error.message }, { status: 422 });
    const existingRow = (rows ?? []).find((r: SurfaceRow) => r.id === existing_surface_id);
    const proposedRow = (rows ?? []).find((r: SurfaceRow) => r.id === proposed_surface_id);
    if (!existingRow || !proposedRow) {
      return NextResponse.json({ error: "One or both surfaces not found for this tenant/project" }, { status: 404 });
    }

    const existingPts = asPoints(existingRow.points);
    const proposedPts = asPoints(proposedRow.points);
    const existingBounds = asBounds(existingRow.bounds);
    const proposedBounds = asBounds(proposedRow.bounds);

    if (existingPts.length < 3 || proposedPts.length < 3) {
      return NextResponse.json({ error: "Each surface needs at least 3 points" }, { status: 422 });
    }
    if (!existingBounds || !proposedBounds) {
      return NextResponse.json({ error: "Surface bounds missing or invalid" }, { status: 422 });
    }

    // Use intersection of bounds so we only sample where both surfaces overlap.
    const minX = Math.max(existingBounds.minX, proposedBounds.minX);
    const maxX = Math.min(existingBounds.maxX, proposedBounds.maxX);
    const minY = Math.max(existingBounds.minY, proposedBounds.minY);
    const maxY = Math.min(existingBounds.maxY, proposedBounds.maxY);
    if (maxX <= minX || maxY <= minY) {
      return NextResponse.json({ error: "Surfaces do not overlap in XY" }, { status: 422 });
    }

    const estRows = Math.ceil((maxY - minY) / gridRes) + 1;
    const estCols = Math.ceil((maxX - minX) / gridRes) + 1;
    if (estRows * estCols > MAX_GRID_CELLS) {
      return NextResponse.json(
        {
          error: `Grid too large: ${estRows * estCols} cells (max ${MAX_GRID_CELLS}). Increase grid_resolution_ft or reduce the overlap area.`,
        },
        { status: 422 }
      );
    }

    const grid = buildGrid({ minX, maxX, minY, maxY }, gridRes);
    const rowsCount = grid.length;
    const colsCount = rowsCount > 0 ? grid[0].length : 0;
    const cellArea = gridRes * gridRes;

    const deltaGrid: number[][] = new Array(rowsCount);
    for (let r = 0; r < rowsCount; r++) {
      const row = new Array<number>(colsCount);
      for (let c = 0; c < colsCount; c++) {
        const at = grid[r][c];
        const ze = idwInterpolate(existingPts, at, 2);
        const zp = idwInterpolate(proposedPts, at, 2);
        row[c] = zp - ze;
      }
      deltaGrid[r] = row;
    }

    const vols = computeVolumes(deltaGrid, cellArea);

    // Stat extremes for caller's color scaling.
    let minDelta = Infinity;
    let maxDelta = -Infinity;
    for (const row of deltaGrid) {
      for (const v of row) {
        if (!Number.isFinite(v)) continue;
        if (v < minDelta) minDelta = v;
        if (v > maxDelta) maxDelta = v;
      }
    }

    const gridJson = {
      origin: { x: minX, y: minY },
      resolution_ft: gridRes,
      rows: rowsCount,
      cols: colsCount,
      min_delta: Number.isFinite(minDelta) ? minDelta : 0,
      max_delta: Number.isFinite(maxDelta) ? maxDelta : 0,
      delta: deltaGrid,
    };

    const { data: saved, error: insertError } = await db
      .from("cut_fill_computations")
       
      .insert({
        tenant_id: tenantId,
        project_id,
        existing_surface_id,
        proposed_surface_id,
        grid_resolution_ft: gridRes,
        cut_volume_cy: vols.cut,
        fill_volume_cy: vols.fill,
        net_volume_cy: vols.net,
        grid: gridJson as unknown as Json,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select("id,computed_at")
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 422 });

    return NextResponse.json({
      computation_id: saved?.id,
      computed_at: saved?.computed_at,
      grid: gridJson,
      summary: {
        cut_cy: vols.cut,
        fill_cy: vols.fill,
        net_cy: vols.net,
        grid_resolution_ft: gridRes,
        cells: rowsCount * colsCount,
        bounds: { minX, maxX, minY, maxY },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/cut-fill/compute] ${msg}` }, { status: 500 });
  }
}
