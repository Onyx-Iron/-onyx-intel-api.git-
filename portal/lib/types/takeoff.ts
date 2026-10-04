/**
 * Shared takeoff types — consolidated from API routes and canvas components.
 */

import type { Point } from "@/lib/takeoff/canvas/coordinates";
import type { VectorPoint } from "@/lib/takeoff/canvas/vector-snap";

// ── Geometry primitives ─────────────────────────────────────────────────────

export type { Point, VectorPoint };

export type CoordinateSpace = "page_space" | "legacy_pixel";

export interface TakeoffGeometry {
  points?: Point[];
  coordinate_space?: CoordinateSpace | string;
  page_number?: number;
  label?: string;
  is_vision_sourced?: boolean;
  [key: string]: unknown;
}

// ── Python bridge (SecureTakeoffRow) ────────────────────────────────────────

export interface SecureTakeoffRow {
  trade: string;
  cost_code: string;
  description: string;
  quantity_basis: string;
  total_qty: number;
  uom: string;
  drawing_ref?: string | null;
  location_tag?: string | null;
}

// ── Manual canvas takeoff ───────────────────────────────────────────────────

export interface ManualTakeoffItem {
  project_id: string;
  page_id?: string | null;
  cost_code?: string | null;
  takeoff_type: "count" | "length" | "area" | string;
  quantity: number;
  unit?: "EA" | "LF" | "SF" | string | null;
  geometry: TakeoffGeometry;
  client_key?: string | null;
  layer_id?: string | null;
}

export interface ManualTakeoffUpdateBody {
  id: string;
  row_version: number;
  quantity: number;
  unit?: string | null;
  cost_code?: string | null;
  geometry: TakeoffGeometry;
  layer_id?: string | null;
}

// ── Calibration ───────────────────────────────────────────────────────────

export interface CalibrationPoint {
  x: number;
  y: number;
}

export interface CalibrationUpsertBody {
  project_id?: string;
  page_id?: string;
  point_a?: CalibrationPoint;
  point_b?: CalibrationPoint;
  known_distance?: number;
  known_unit?: string;
  /** Apply a confirmed recalibration to draft measurements on this sheet. */
  apply_to_drafts?: boolean;
  scale_preset?: string;
  suggestion_only?: boolean;
}

// ── Civil utility pipe runs ─────────────────────────────────────────────────

export type SystemType = "Sanitary Sewer" | "Storm Drain" | "Water Line" | "Fire Line";

export interface UtilityRunItem {
  project_id: string;
  page_id?: string | null;
  cost_code?: string | null;
  system_type: SystemType | string;
  pipe_diameter_in: number;
  invert_elevation_start: number;
  invert_elevation_end: number;
  trench_width_ft: number;
  run_length_lf: number;
  geometry: unknown;
}

// ── Topographic nodes ───────────────────────────────────────────────────────

export interface TopoNodeItem {
  project_id: string;
  page_id: string;
  node_type: "contour_line" | "spot_elevation";
  elevation: number;
  geometry: unknown;
  layer_assignment?: string | null;
}

// ── Area bounds ─────────────────────────────────────────────────────────────

export type BoundaryKind =
  | "topsoil_stripping"
  | "building_pad"
  | "asphalt_paving"
  | "concrete_flatwork";

export interface AreaBoundItem {
  project_id: string;
  page_id?: string | null;
  boundary_kind: BoundaryKind | string;
  area_sf: number;
  stripping_depth_in?: number | null;
  excavation_volume_cy?: number | null;
  target_cost_code?: string | null;
  boundary_geometry: unknown;
}

// ── Vision extraction ─────────────────────────────────────────────────────────

export interface VisionItem {
  label: string;
  csi_code?: string | null;
  quantity?: number | null;
  unit?: string | null;
  confidence?: number | null;
  bbox?: { x: number; y: number; w: number; h: number } | null;
}

export interface VisionResult {
  page_id: string;
  items: VisionItem[];
  model?: string;
  extracted_at?: string;
}

export interface VisionTakeoffItemRef {
  takeoff_item_id: string;
  item_key: string;
}

// ── Civil trench math (Python bridge) ───────────────────────────────────────

export interface CivilTrenchRequest {
  length_lf: number;
  pipe_od_in: number;
  cover_ft?: number;
  soil_type?: "A" | "B" | "C" | "stable_rock" | string;
  trench_width_ft?: number | null;
  initial_backfill_in?: number;
  include_layback?: boolean;
}

export interface CivilTrenchResult {
  soil_type: string;
  layback_ratio: number;
  pipe_od_ft: number;
  bedding_depth_in: number;
  bedding_depth_ft: number;
  safety_width_offset_ft: number;
  trench_bottom_width_ft: number;
  trench_depth_ft: number;
  cover_ft: number;
  initial_backfill_ft: number;
  excavation_bcy: number;
  rectangular_excavation_bcy: number;
  layback_volume_bcy: number;
  top_width_ft: number;
  cross_section_sf: number;
  layback_offset_ft_per_side: number;
  bedding_material_cy: number;
  aggregate_import_cy: number;
}
