/**
 * Civil site-scope calculators — the pieces beyond bulk cut/fill.
 *
 * Every function returns Bank Cubic Yards for excavation totals and a
 * per-material breakdown ready for procurement.
 *
 * References:
 *   - Pipe trench + embedment layout: ASTM D2321 / typical DOT std drawings
 *   - Construction entrance: FHWA / most state DOT stabilized-construction-
 *     entrance details, typical 50 ft × 20 ft × 6-12" of 2-3" stone
 *   - Aggregate density: crushed stone ~1.5 tons/CY loose, ~1.7 tons/CY compacted
 */

// ─────────────────────────────────────────────────────────────────────────────
// Common helpers
// ─────────────────────────────────────────────────────────────────────────────
const CF_PER_CY = 27;
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Density of a compacted aggregate lift, tons per CY.
 * 105 pcf compacted × 27 / 2000 ≈ 1.42; realistic crushed 2–3" stone runs
 * ~1.5 tons/CY compacted.
 */
const AGGREGATE_TONS_PER_CY = 1.5;

// ─────────────────────────────────────────────────────────────────────────────
// PIPE EMBEDMENT + BACKFILL — per pipe run
// ─────────────────────────────────────────────────────────────────────────────
export interface PipeRunInput {
  length_lf: number;
  diameter_in: number;
  trench_width_ft: number;
  avg_depth_ft: number;                    // TOP of pipe → surface (i.e., cover)
  bedding_depth_in?: number;               // default 6"
  haunch_depth_in?: number;                // default 6" — usually = ½ diameter
  initial_backfill_over_pipe_in?: number;  // default 12"
  swell_factor?: number;                   // default 1.15
  shrink_factor?: number;                  // default 0.85
}

export interface PipeRunResult {
  trench_excavation_bcy: number;
  bedding_cy: number;                      // structural bedding under pipe
  haunching_cy: number;                    // #57 stone up alongside pipe
  initial_backfill_cy: number;             // clean granular over pipe
  common_backfill_cy: number;              // native / suitable to grade
  pipe_displacement_cy: number;
  spoils_export_bcy: number;               // trench excavation - common backfill
  bedding_tons: number;
  haunching_tons: number;
  initial_backfill_tons: number;
  totals: {
    aggregate_import_cy: number;           // bedding + haunching + initial (all clean stone)
    aggregate_import_tons: number;
    backfill_from_native_bcy: number;
    trench_dewatering_hint_ft: number;     // depth below surface — a signal to add dewatering scope
  };
}

/**
 * Compute pipe trench embedment layout.
 *
 * Trench cross-section (bottom → top):
 *   [ bedding ] → [ haunch ][ pipe ][ haunch ] → [ initial backfill ] → [ common backfill ]
 *
 * Total trench depth = bedding + pipe OD + initial_backfill + common_backfill
 * where common_backfill = avg_depth_ft (the specified cover)
 */
export function calcPipeEmbedment(inp: PipeRunInput): PipeRunResult {
  const lengthFt   = inp.length_lf;
  const trenchW    = inp.trench_width_ft;
  const cover      = inp.avg_depth_ft;
  const beddingFt  = (inp.bedding_depth_in ?? 6) / 12;
  const haunchFt   = (inp.haunch_depth_in ?? 6) / 12;
  const initialFt  = (inp.initial_backfill_over_pipe_in ?? 12) / 12;
  const diameterFt = inp.diameter_in / 12;

  // Trench depth (feet): bedding + pipe outside dia + initial backfill + cover
  const trenchDepth = beddingFt + diameterFt + initialFt + cover;

  // Total trench excavation (CF → CY)
  const trenchExcCf  = lengthFt * trenchW * trenchDepth;
  const trenchExcBcy = trenchExcCf / CF_PER_CY;

  // Bedding — full trench width × bedding thickness × length
  const beddingCf = lengthFt * trenchW * beddingFt;
  const beddingCy = beddingCf / CF_PER_CY;

  // Haunching — trench width minus pipe diameter, × haunch height, × length
  // Approximated: (trenchW - diameterFt) × haunchFt × length. Modeled here as
  // clean stone alongside the pipe.
  const haunchCf = lengthFt * Math.max(0, trenchW - diameterFt) * haunchFt;
  const haunchCy = haunchCf / CF_PER_CY;

  // Initial backfill — full trench width × 12" (typ) over pipe
  const initialCf = lengthFt * trenchW * initialFt;
  const initialCy = initialCf / CF_PER_CY;

  // Pipe displacement — π(d/2)² × length
  const pipeDispCf = lengthFt * Math.PI * (diameterFt / 2) ** 2;
  const pipeDispCy = pipeDispCf / CF_PER_CY;

  // Common backfill (native suitable up to grade) — trench cross section from
  // top-of-initial-backfill up to surface, MINUS pipe/embedment already there.
  // Simplified: trench_area × cover
  const commonCf = lengthFt * trenchW * cover;
  const commonCy = commonCf / CF_PER_CY;

  // Spoils = trench excavation - common backfill (assuming imported bedding
  // + haunch + initial replace native volume)
  const spoilsBcy = Math.max(0, trenchExcBcy - commonCy);

  // Import aggregate summary — anything not native
  const importCy = beddingCy + haunchCy + initialCy;
  const importTons = importCy * AGGREGATE_TONS_PER_CY;

  return {
    trench_excavation_bcy: round(trenchExcBcy),
    bedding_cy:            round(beddingCy),
    haunching_cy:          round(haunchCy),
    initial_backfill_cy:   round(initialCy),
    common_backfill_cy:    round(commonCy),
    pipe_displacement_cy:  round(pipeDispCy),
    spoils_export_bcy:     round(spoilsBcy),
    bedding_tons:          round(beddingCy * AGGREGATE_TONS_PER_CY),
    haunching_tons:        round(haunchCy * AGGREGATE_TONS_PER_CY),
    initial_backfill_tons: round(initialCy * AGGREGATE_TONS_PER_CY),
    totals: {
      aggregate_import_cy:  round(importCy),
      aggregate_import_tons: round(importTons),
      backfill_from_native_bcy: round(commonCy),
      trench_dewatering_hint_ft: trenchDepth,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTION ENTRANCE — stabilized gravel pad at each ingress point
// ─────────────────────────────────────────────────────────────────────────────
export interface ConstructionEntranceInput {
  length_ft: number;                 // typical 50-100
  width_ft: number;                  // typical 20-30
  depth_in: number;                  // typical 6-12
  fabric_underlayment?: boolean;
}
export interface ConstructionEntranceResult {
  stone_cy: number;
  stone_tons: number;
  fabric_sy: number;
  area_sf: number;
}
export function calcConstructionEntrance(inp: ConstructionEntranceInput): ConstructionEntranceResult {
  const areaSf = inp.length_ft * inp.width_ft;
  const stoneCf = areaSf * (inp.depth_in / 12);
  const stoneCy = stoneCf / CF_PER_CY;
  const fabricSy = inp.fabric_underlayment ? areaSf / 9 : 0;
  return {
    stone_cy: round(stoneCy),
    stone_tons: round(stoneCy * AGGREGATE_TONS_PER_CY),
    fabric_sy: round(fabricSy),
    area_sf: round(areaSf),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCKPILE — loose volume from a BCY quantity + swell
// ─────────────────────────────────────────────────────────────────────────────
export interface StockpileInput { volume_bcy: number; swell_factor?: number }
export interface StockpileResult { bcy: number; lcy: number; ccy: number; area_est_sf: number }
export function calcStockpile(inp: StockpileInput): StockpileResult {
  const swell = inp.swell_factor ?? 1.15;
  const lcy = inp.volume_bcy * swell;
  const ccy = inp.volume_bcy * 0.85;
  // Rough footprint estimate: 2:1 side slopes, 8 ft avg height → volume ≈ H² × L for prism-ish shape.
  // For an 8 ft high pile with 2:1 slopes, planar footprint ≈ (LCY * 27) / 8 (planar area in SF).
  const areaEst = lcy > 0 ? (lcy * 27) / 8 : 0;
  return {
    bcy: round(inp.volume_bcy),
    lcy: round(lcy),
    ccy: round(ccy),
    area_est_sf: round(areaEst),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT / EXPORT LEDGER TOTALS — aggregate a set of ledger rows
// ─────────────────────────────────────────────────────────────────────────────
export interface LedgerRow {
  direction: "import" | "export" | "stockpile_in" | "stockpile_out";
  material_type: string;
  quantity_bcy?: number | null;
  quantity_ton?: number | null;
  unit_price?: number | null;
  haul_distance_mi?: number | null;
}
export interface LedgerTotals {
  import_bcy: number;
  export_bcy: number;
  stockpile_bcy: number;
  by_material: Record<string, { import_bcy: number; export_bcy: number }>;
  estimated_cost: number;                // sum of qty × unit_price where present
  ton_miles: number;                     // qty_ton × haul_distance (transport metric)
}
export function summarizeLedger(rows: LedgerRow[]): LedgerTotals {
  const t: LedgerTotals = { import_bcy: 0, export_bcy: 0, stockpile_bcy: 0, by_material: {}, estimated_cost: 0, ton_miles: 0 };
  for (const r of rows) {
    const bcy = Number(r.quantity_bcy ?? 0);
    const ton = Number(r.quantity_ton ?? 0);
    const price = Number(r.unit_price ?? 0);
    const dist = Number(r.haul_distance_mi ?? 0);
    if (r.direction === "import")       t.import_bcy += bcy;
    else if (r.direction === "export")  t.export_bcy += bcy;
    else if (r.direction === "stockpile_in")  t.stockpile_bcy += bcy;
    else if (r.direction === "stockpile_out") t.stockpile_bcy -= bcy;
    if (!t.by_material[r.material_type]) t.by_material[r.material_type] = { import_bcy: 0, export_bcy: 0 };
    if (r.direction === "import") t.by_material[r.material_type].import_bcy += bcy;
    if (r.direction === "export") t.by_material[r.material_type].export_bcy += bcy;
    t.estimated_cost += (bcy || ton) * price;
    t.ton_miles += ton * dist;
  }
  return {
    ...t,
    import_bcy: round(t.import_bcy),
    export_bcy: round(t.export_bcy),
    stockpile_bcy: round(t.stockpile_bcy),
    estimated_cost: round(t.estimated_cost),
    ton_miles: round(t.ton_miles),
  };
}

export const CIVIL_MATERIAL_DENSITY_TON_PER_CY = AGGREGATE_TONS_PER_CY;
