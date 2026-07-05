// Composite trade assembly math — concrete, paving, and deep utility quantity
// takeoffs derived from a handful of geometric/spec variables an estimator
// enters once (area, thickness, mix design, rebar spacing) instead of hand
// calculating each material row.

export interface AssemblyVariables {
  area_sf: number;
  thickness_inches: number;
  waste_multiplier?: number;
  base_depth_inches?: number;
  rebar_size?: RebarSize;
  rebar_spacing_inches?: number;
  // Grid run lengths (linear feet) for two-way rebar mats — one entry per
  // direction. For a simple slab this is just [length_ft, width_ft].
  grid_run_lengths_ft?: number[];
}

// ASTM A615 standard rebar sizes: unit weight in lbs per linear foot.
export const REBAR_UNIT_WEIGHT_LBS_PER_FT: Record<RebarSize, number> = {
  "#3": 0.376,
  "#4": 0.668,
  "#5": 1.043,
  "#6": 1.502,
  "#7": 2.044,
  "#8": 2.670,
  "#9": 3.400,
  "#10": 4.303,
  "#11": 5.313,
};

export type RebarSize = "#3" | "#4" | "#5" | "#6" | "#7" | "#8" | "#9" | "#10" | "#11";

const CY_PER_CF = 27; // cubic feet per cubic yard
const BASE_MATERIAL_DENSITY_LBS_PER_CF = 145; // compacted aggregate base, lbs/cf
const LBS_PER_TON = 2000;

/** Concrete Volume (CY) = (Area_SF * (Thickness_Inches / 12)) / 27 * Waste_Multiplier */
export function concreteVolumeCY(vars: Pick<AssemblyVariables, "area_sf" | "thickness_inches" | "waste_multiplier">): number {
  const waste = vars.waste_multiplier ?? 1;
  const cubicFeet = vars.area_sf * (vars.thickness_inches / 12);
  return (cubicFeet / CY_PER_CF) * waste;
}

/** Base Material Weight (Tons) = (Area_SF * (Base_Depth_Inches / 12) * 145 lbs/cf) / 2000 */
export function baseMaterialWeightTons(vars: Pick<AssemblyVariables, "area_sf" | "base_depth_inches">): number {
  const depth = vars.base_depth_inches ?? 0;
  const cubicFeet = vars.area_sf * (depth / 12);
  return (cubicFeet * BASE_MATERIAL_DENSITY_LBS_PER_CF) / LBS_PER_TON;
}

/**
 * Rebar Weight (Lbs) = sum of grid-line run lengths * bars-per-run * unit weight.
 *
 * For each direction in `grid_run_lengths_ft`, the number of parallel bars
 * spanning the perpendicular dimension is `perpendicular_length_ft * 12 /
 * rebar_spacing_inches`. Total weight is each direction's (bar count * run
 * length) summed, times the ASTM unit weight for the chosen bar size.
 */
export function rebarWeightLbs(vars: Pick<AssemblyVariables, "grid_run_lengths_ft" | "rebar_spacing_inches" | "rebar_size">): number {
  const runs = vars.grid_run_lengths_ft ?? [];
  const spacingIn = vars.rebar_spacing_inches;
  const size = vars.rebar_size;
  if (runs.length < 2 || !spacingIn || spacingIn <= 0 || !size) return 0;

  const unitWeight = REBAR_UNIT_WEIGHT_LBS_PER_FT[size];
  let totalLinearFeet = 0;
  for (let dir = 0; dir < runs.length; dir++) {
    const runLength = runs[dir];
    const perpendicular = runs[(dir + 1) % runs.length];
    const barCount = Math.ceil((perpendicular * 12) / spacingIn) + 1;
    totalLinearFeet += runLength * barCount;
  }
  return totalLinearFeet * unitWeight;
}

export interface AssemblyQuantities {
  concrete_cy: number;
  base_material_tons: number;
  rebar_lbs: number;
}

export function calculateAssemblyQuantities(vars: AssemblyVariables): AssemblyQuantities {
  return {
    concrete_cy: round(concreteVolumeCY(vars)),
    base_material_tons: round(baseMaterialWeightTons(vars)),
    rebar_lbs: round(rebarWeightLbs(vars)),
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
