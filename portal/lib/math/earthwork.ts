/**
 * Civil Earthwork Math — grid-based surface comparison.
 *
 * Inputs are two surfaces (Existing, Proposed) resampled onto a common
 * rectangular grid. Elevation differential Δz at each node drives cut/fill
 * volume via the prismoidal composite-block method:
 *
 *     Volume (CY) = Σ (cell_area_sf × Δz) / 27
 *
 * We use bilinear cell averaging so a cell's Δz is the average of its four
 * corner nodes — cheaper than a full prismoidal (top × bot × mid) but the
 * same class of error for typical civil grids and stable to sparse data.
 *
 * All volumes returned by the core routine are Bank Cubic Yards (BCY).
 * The `applyMaterialFactors` helper converts BCY ↔ LCY ↔ CCY.
 *
 * Deductions modeled:
 *   - Topsoil stripping (uniform depth across a polygon) → adds to cut BCY
 *   - Over-excavation under building pads (uniform depth under polygon(s))
 *     → adds to cut BCY on that area
 *   - Select fill lifts (uniform depth atop finished subgrade in an area)
 *     → adds to fill BCY on that area
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface GridSurface {
  /** cell size in feet; grid must be square */
  grid_size: number;
  /** world coords of the (0,0) node — usually SW corner */
  origin: [number, number];
  /** rows[y][x] = elevation. Null holes are allowed. */
  nodes: Array<Array<number | null>>;
  /** optional units label — assumed feet */
  units?: "ft" | "m";
}

export interface Polygon {
  points: Array<[number, number]>;  // in the same world CRS as origin
}

export interface Deductions {
  topsoil?: {
    depth_ft: number;
    /** if omitted, applied across the whole grid extent */
    polygons?: Polygon[];
  };
  over_excavation?: {
    depth_ft: number;
    polygons: Polygon[];              // required — no site-wide over-ex
  };
  select_fill?: {
    depth_ft: number;
    polygons: Polygon[];
  };
}

export interface MaterialFactors {
  /** compacted / bank ratio, e.g. 0.85 means bank soil compacts to 85% */
  shrink_factor?: number;
  /** loose / bank ratio, e.g. 1.15 means bank soil loosens to 115% */
  swell_factor?: number;
}

export interface EarthworkResult {
  cut_bcy: number;
  fill_bcy: number;
  net_bcy: number;                      // cut - fill  (+ export, - import)
  cell_area_sf: number;
  cells_evaluated: number;
  cells_holes: number;
  extents_sf: number;
  deduction_details: {
    topsoil_bcy: number;
    over_excavation_bcy: number;
    select_fill_bcy: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core algorithm
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compare two grids of the SAME shape + origin + spacing. Emits raw cut/fill
 * BCY at nodes where BOTH surfaces have a value (holes are skipped and counted).
 *
 * If your two surfaces have different grids, resample them to a common one
 * BEFORE calling this — `resampleToGrid` below handles that.
 */
export function compareGrids(existing: GridSurface, proposed: GridSurface): EarthworkResult {
  if (existing.grid_size !== proposed.grid_size) {
    throw new Error(`grid mismatch: existing=${existing.grid_size} proposed=${proposed.grid_size}`);
  }
  if (existing.origin[0] !== proposed.origin[0] || existing.origin[1] !== proposed.origin[1]) {
    throw new Error("grid origin mismatch");
  }
  const G = existing.grid_size;
  const cellArea = G * G;
  const rowsE = existing.nodes;
  const rowsP = proposed.nodes;
  const ny = Math.min(rowsE.length, rowsP.length);
  const nx = Math.min(rowsE[0]?.length ?? 0, rowsP[0]?.length ?? 0);

  let cutBcy = 0, fillBcy = 0, cells = 0, holes = 0;

  // Iterate CELLS (nx-1 × ny-1) instead of NODES — cell Δz is the mean of
  // its four corners.
  for (let y = 0; y < ny - 1; y++) {
    for (let x = 0; x < nx - 1; x++) {
      const corners = [
        [rowsE[y][x],       rowsP[y][x]],
        [rowsE[y][x + 1],   rowsP[y][x + 1]],
        [rowsE[y + 1][x],   rowsP[y + 1][x]],
        [rowsE[y + 1][x+1], rowsP[y + 1][x+1]],
      ] as Array<[number | null, number | null]>;
      if (corners.some(([a, b]) => a == null || b == null)) { holes++; continue; }
       
      const dz = ((corners[0][1]! - corners[0][0]!) + (corners[1][1]! - corners[1][0]!) +
                  (corners[2][1]! - corners[2][0]!) + (corners[3][1]! - corners[3][0]!)) / 4;
      const cy = (cellArea * dz) / 27;
      if (cy > 0) fillBcy += cy;       // proposed higher = fill
      else       cutBcy  += -cy;
      cells++;
    }
  }

  const extentsSf = cells * cellArea;
  return {
    cut_bcy: round(cutBcy),
    fill_bcy: round(fillBcy),
    net_bcy: round(cutBcy - fillBcy),
    cell_area_sf: cellArea,
    cells_evaluated: cells,
    cells_holes: holes,
    extents_sf: extentsSf,
    deduction_details: { topsoil_bcy: 0, over_excavation_bcy: 0, select_fill_bcy: 0 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deductions — added on top of the grid comparison result
// ─────────────────────────────────────────────────────────────────────────────
export function applyDeductions(baseResult: EarthworkResult, grid: GridSurface, deductions: Deductions | undefined): EarthworkResult {
  if (!deductions) return baseResult;
  const G = grid.grid_size;
  const cellArea = G * G;
  const nx = (grid.nodes[0]?.length ?? 1) - 1;
  const ny = grid.nodes.length - 1;

  const centerOf = (cx: number, cy: number): [number, number] => [
    grid.origin[0] + (cx + 0.5) * G,
    grid.origin[1] + (cy + 0.5) * G,
  ];

  // Helper: sum cells whose centres are inside any polygon (or entire grid).
  const sumCells = (polys: Polygon[] | undefined): number => {
    if (!polys || polys.length === 0) return nx * ny; // whole grid
    let count = 0;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const [wx, wy] = centerOf(x, y);
        if (polys.some((p) => pointInPolygon(wx, wy, p.points))) count++;
      }
    }
    return count;
  };

  // Topsoil: adds to CUT (we strip it before doing anything).
  const topsoilCells = deductions.topsoil ? sumCells(deductions.topsoil.polygons) : 0;
  const topsoilBcy   = deductions.topsoil ? (topsoilCells * cellArea * deductions.topsoil.depth_ft) / 27 : 0;

  // Over-excavation: adds to CUT (dig deeper under pads).
  const oxCells = deductions.over_excavation ? sumCells(deductions.over_excavation.polygons) : 0;
  const oxBcy   = deductions.over_excavation ? (oxCells * cellArea * deductions.over_excavation.depth_ft) / 27 : 0;

  // Select fill: adds to FILL (imported clean structural fill).
  const sfCells = deductions.select_fill ? sumCells(deductions.select_fill.polygons) : 0;
  const sfBcy   = deductions.select_fill ? (sfCells * cellArea * deductions.select_fill.depth_ft) / 27 : 0;

  const cut  = baseResult.cut_bcy + topsoilBcy + oxBcy;
  const fill = baseResult.fill_bcy + sfBcy;
  return {
    ...baseResult,
    cut_bcy: round(cut),
    fill_bcy: round(fill),
    net_bcy: round(cut - fill),
    deduction_details: {
      topsoil_bcy: round(topsoilBcy),
      over_excavation_bcy: round(oxBcy),
      select_fill_bcy: round(sfBcy),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Material factor transforms — BCY ↔ LCY ↔ CCY
// ─────────────────────────────────────────────────────────────────────────────
export interface MaterialBreakdown {
  bcy: number;
  lcy: number;    // loose = bank × swell
  ccy: number;    // compacted = bank × shrink
}

export function applyMaterialFactors(bank_cy: number, factors: MaterialFactors = {}): MaterialBreakdown {
  const shrink = factors.shrink_factor ?? 0.85;
  const swell  = factors.swell_factor  ?? 1.15;
  return {
    bcy: round(bank_cy),
    lcy: round(bank_cy * swell),
    ccy: round(bank_cy * shrink),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mass haul summary — sits on top of the raw result + factors
// ─────────────────────────────────────────────────────────────────────────────
export interface MassHaulSummary {
  cut: MaterialBreakdown;
  fill: MaterialBreakdown;
  net_bcy: number;
  /** Trucking volume — moving BANK to a compacted state on-site consumes
   *  MORE bank than the compacted volume it produces. So fill covered on-site
   *  from cut requires cut_bcy × shrink_factor to satisfy fill_ccy — the
   *  planner uses fill_bcy directly. */
  onsite_reuse_bcy: number;
  /** If we can't cover fill from cut on this project, we must import. */
  import_bcy: number;
  /** Excess bank goes to export (positive = leave the site). */
  export_bcy: number;
  /** Truck-load count assuming 12 CY dump-truck loose payload. */
  truck_loads_export: number;
  truck_loads_import: number;
}

export function massHaulSummary(result: EarthworkResult, factors: MaterialFactors = {}, truckPayloadCy = 12): MassHaulSummary {
  const cut  = applyMaterialFactors(result.cut_bcy, factors);
  const fill = applyMaterialFactors(result.fill_bcy, factors);
  const onsite_reuse_bcy = Math.min(cut.bcy, fill.bcy);
  const export_bcy = Math.max(0, cut.bcy - fill.bcy);
  const import_bcy = Math.max(0, fill.bcy - cut.bcy);
  const truck_loads_export = Math.ceil((applyMaterialFactors(export_bcy, factors).lcy) / truckPayloadCy);
  const truck_loads_import = Math.ceil((applyMaterialFactors(import_bcy, factors).lcy) / truckPayloadCy);
  return {
    cut, fill,
    net_bcy: round(cut.bcy - fill.bcy),
    onsite_reuse_bcy: round(onsite_reuse_bcy),
    import_bcy: round(import_bcy),
    export_bcy: round(export_bcy),
    truck_loads_export,
    truck_loads_import,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Point-in-polygon (ray casting) — used by deduction geo tests
// ─────────────────────────────────────────────────────────────────────────────
export function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function round(v: number): number { return Math.round(v * 100) / 100; }
