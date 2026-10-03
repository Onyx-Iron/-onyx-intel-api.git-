/**
 * Takeoff provenance stamps (OSS-04 / OSS-05).
 *
 * Inspired by OpenTakeoff origin+approval patterns (Apache ideas only —
 * reimplemented for Onyx). Human seals live in review_status +
 * approved_by/approved_at; this module only classifies origin and whether
 * a row still needs a human seal before estimate impact.
 */

export type OriginActor = "human" | "agent" | "deterministic_parser";

export type OriginMethod =
  | "manual"
  | "vision"
  | "ai_vision"
  | "vector"
  | "civil_calculator"
  | "deterministic"
  | "pdf_table"
  | "dxf"
  | "ifc"
  | "xlsx"
  | string;

export interface ProvenanceStamp {
  origin_actor: OriginActor;
  origin_method: OriginMethod;
  origin_edited: boolean;
  source_method: string;
  review_status: "suggested" | "reviewed" | "approved" | "rejected";
}

const AGENT_METHODS = new Set(["ai_vision", "vision"]);
const PARSER_METHODS = new Set([
  "civil_calculator",
  "deterministic",
  "pdf_table",
  "dxf",
  "ifc",
  "xlsx",
  "vector",
]);

/** Map an extraction / source method to origin_actor. */
export function actorForMethod(method: string | null | undefined): OriginActor {
  const m = (method ?? "").toLowerCase();
  if (AGENT_METHODS.has(m)) return "agent";
  if (PARSER_METHODS.has(m)) return "deterministic_parser";
  if (m === "manual" || m === "") return "human";
  return "deterministic_parser";
}

/**
 * Build insert/upsert fields for a new takeoff_items row.
 * Agent/vision origins start as `suggested` and must not reach estimates
 * until a human approve action (see /api/takeoff/items/[id]/review).
 */
export function provenanceForNewItem(opts: {
  sourceMethod: OriginMethod;
  /** When true, force agent+suggested regardless of sourceMethod. */
  isVisionSourced?: boolean;
  /** Human already sealed this row (e.g. civil mirror, manual canvas). */
  preApproved?: boolean;
}): ProvenanceStamp {
  const method = opts.isVisionSourced ? "ai_vision" : opts.sourceMethod;
  const actor = opts.isVisionSourced ? "agent" : actorForMethod(method);
  const needsSeal = actor === "agent" && !opts.preApproved;
  return {
    origin_actor: actor,
    origin_method: method,
    origin_edited: false,
    source_method: method === "vision" ? "ai_vision" : String(method),
    review_status: needsSeal ? "suggested" : "approved",
  };
}

/** True when the row must not affect estimate rollups / sync. */
export function needsHumanSeal(row: {
  review_status?: string | null;
  origin_actor?: string | null;
  source_method?: string | null;
}): boolean {
  const status = row.review_status ?? "approved";
  if (status === "suggested" || status === "reviewed" || status === "rejected") {
    return true;
  }
  // Belt-and-suspenders: agent origin without an approved seal.
  if (row.origin_actor === "agent" && status !== "approved") return true;
  if (AGENT_METHODS.has((row.source_method ?? "").toLowerCase()) && status !== "approved") {
    return true;
  }
  return false;
}

/** Detect AI vision payload from takeoff tab / API meta. */
export function isVisionMeta(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false;
  const method = String(meta.extraction_method ?? meta.origin_method ?? "").toLowerCase();
  return method === "ai_vision" || method === "vision" || meta.is_vision_sourced === true;
}
