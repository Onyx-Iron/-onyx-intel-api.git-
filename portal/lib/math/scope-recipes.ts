// Expands one drawn utility run or wall into the material lines an estimate
// can price. Quantities come only from calcPipeEmbedment and the assembly
// helpers. Zero quantities are omitted. No labor/material/equipment split
// is invented here.

import { calculateAssemblyQuantities, rebarWeightLbs, type RebarSize } from "@/lib/math/assemblies";
import { calcPipeEmbedment, type PipeRunResult } from "@/lib/math/civil-scope";

export interface RecipeLine {
  label: string;
  csi_code: string;
  quantity: number;
  unit: string;
}

export function csiForUtilitySystem(system: string): string {
  const name = system.toLowerCase();
  if (name.includes("sanitary")) return "33-30-00";
  if (name.includes("storm")) return "33-40-00";
  return "33-10-00";
}

export interface UtilityRecipeInput {
  name: string;
  system: string;
  diameter_in: number;
  length_lf: number;
  embedment: PipeRunResult;
  pipe_csi?: string | null;
}

export function utilityRecipeLines(input: UtilityRecipeInput): RecipeLine[] {
  const pipeCsi = input.pipe_csi && input.pipe_csi.trim() ? input.pipe_csi.trim() : csiForUtilitySystem(input.system);
  const who = input.name.trim() || input.system;
  const embedment = input.embedment;
  const lines: RecipeLine[] = [
    {
      label: `${who} pipe (${input.diameter_in}" dia)`,
      csi_code: pipeCsi,
      quantity: input.length_lf,
      unit: "LF",
    },
    {
      label: `${who} trench excavation`,
      csi_code: "31-23-16",
      quantity: embedment.trench_excavation_bcy,
      unit: "CY",
    },
    {
      label: `${who} trench bedding`,
      csi_code: "31-23-23",
      quantity: embedment.bedding_cy,
      unit: "CY",
    },
    {
      label: `${who} trench haunching`,
      csi_code: "31-23-23",
      quantity: embedment.haunching_cy,
      unit: "CY",
    },
    {
      label: `${who} trench initial backfill`,
      csi_code: "31-23-23",
      quantity: embedment.initial_backfill_cy,
      unit: "CY",
    },
    {
      label: `${who} trench common backfill`,
      csi_code: "31-23-16",
      quantity: embedment.common_backfill_cy,
      unit: "CY",
    },
    {
      label: `${who} trench spoils export`,
      csi_code: "31-23-16",
      quantity: embedment.spoils_export_bcy,
      unit: "CY",
    },
  ];
  return lines.filter((line) => line.quantity > 0);
}

export interface WallRecipeInput {
  name?: string;
  length_lf: number;
  height_ft: number;
  thickness_in: number;
  waste_multiplier?: number;
  rebar_size?: RebarSize;
  rebar_spacing_inches?: number;
}

export function wallRecipeLines(input: WallRecipeInput): RecipeLine[] {
  if (input.length_lf <= 0 || input.height_ft <= 0 || input.thickness_in <= 0) return [];
  const who = input.name?.trim() || "Wall";
  const faceSf = input.length_lf * input.height_ft;
  const quantities = calculateAssemblyQuantities({
    area_sf: faceSf,
    thickness_inches: input.thickness_in,
    waste_multiplier: input.waste_multiplier ?? 1,
    grid_run_lengths_ft: [input.length_lf, input.height_ft],
    rebar_size: input.rebar_size,
    rebar_spacing_inches: input.rebar_spacing_inches,
  });
  const formworkSf = round2(faceSf * 2);
  const rebarLbs = round2(rebarWeightLbs({
    grid_run_lengths_ft: [input.length_lf, input.height_ft],
    rebar_size: input.rebar_size,
    rebar_spacing_inches: input.rebar_spacing_inches,
  }));
  const lines: RecipeLine[] = [
    {
      label: `${who} concrete (${input.thickness_in}" thick)`,
      csi_code: "03-30-00",
      quantity: quantities.concrete_cy,
      unit: "CY",
    },
    {
      label: `${who} formwork, both faces`,
      csi_code: "03-11-00",
      quantity: formworkSf,
      unit: "SF",
    },
    {
      label: input.rebar_size
        ? `${who} rebar ${input.rebar_size} @ ${input.rebar_spacing_inches}"`
        : `${who} rebar`,
      csi_code: "03-20-00",
      quantity: rebarLbs,
      unit: "LB",
    },
  ];
  return lines.filter((line) => line.quantity > 0);
}

export function utilityRecipeFromRun(input: {
  name: string;
  system: string;
  diameter_in: number;
  length_lf: number;
  trench_width_ft: number;
  avg_depth_ft?: number;
  pipe_csi?: string | null;
}): RecipeLine[] {
  const embedment = calcPipeEmbedment({
    length_lf: input.length_lf,
    diameter_in: input.diameter_in,
    trench_width_ft: input.trench_width_ft,
    avg_depth_ft: input.avg_depth_ft ?? 4,
  });
  return utilityRecipeLines({ ...input, embedment });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
