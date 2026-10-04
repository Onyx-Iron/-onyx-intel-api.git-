/**
 * Scope Gap Verification Agent
 * -------------------------------
 * Compares saved takeoff rows with the CSI rules in layer-classify.
 * It does not send the sheet to a model. Anything on the sheet with no
 * matching estimate line becomes an audit trail the human can approve.
 *
 * Invariant: this file NEVER writes to `estimate_items` directly. It
 * only produces `ai_agent_audit_trails` rows with `status =
 * 'pending_human_review'` and structured `recommendations` the approval
 * route consumes.
 */

import { classifyLayer } from "@/lib/cad/layer-classify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAnyClient = any;

interface VisionItem {
  description: string;
  quantity: number;
  unit: string;
  cost_code?: string;
  layer_hint?: string;
  source: "schedule" | "note" | "callout" | "image" | "text";
  confidence: number;
  raw_text?: string;
}

interface RunArgs {
  db: SupabaseAnyClient;
  tenantId: string;
  projectId: string;
  pageId: string;
  documentId: string | null;
  visionItems: VisionItem[];
}

interface Recommendation {
  action: "insert_estimate_line";
  item: {
    cost_code: string | null;
    description: string;
    quantity: number;
    unit: string;
    labor_unit: number;
    material_unit: number;
    equipment_unit: number;
    subcontractor_unit: number;
    trucking_unit: number;
    disposal_unit: number;
    notes: string | null;
    source: string;
  };
  cross_verified: boolean;
  confidence: number;
  vision_source: VisionItem["source"];
  raw_text?: string;
}

export async function runScopeGapAgent({ db, tenantId, projectId, pageId, documentId, visionItems }: RunArgs): Promise<{ inserted: number }> {
  // Only high-confidence items (>= 0.6) are eligible for gap flagging.
  const eligible = visionItems.filter((v) => v.confidence >= 0.6 && v.quantity > 0 && v.description.trim().length > 3);
  if (eligible.length === 0) return { inserted: 0 };

  // Pull existing estimate lines' descriptions + cost codes for match testing
  // from the authoritative estimate_items table (project_estimates is deprecated).
  const { data: existing } = await db
    .from("estimate_items")
    .select("description, cost_code, csi_code")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);

  const seenCodes = new Set<string>();
  const seenDescs: string[] = [];
  for (const r of (existing ?? []) as Array<{ description: string | null; cost_code: string | null; csi_code: string | null }>) {
    if (r.cost_code) seenCodes.add(r.cost_code);
    if (r.csi_code) seenCodes.add(r.csi_code);
    if (r.description) seenDescs.push(r.description.toLowerCase());
  }

  // Also cross-reference against vector-derived findings on the same page
  // (source=cad_vector approved to manual_takeoffs). This is where the
  // "verified" boost comes from.
  const { data: vecFindings } = await db
    .from("manual_takeoffs")
    .select("cost_code, geometry")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("page_id", pageId);
  const vecDescriptions: string[] = [];
  for (const m of (vecFindings ?? []) as Array<{ cost_code: string | null; geometry: unknown }>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = m.geometry as any;
    if (g?.description) vecDescriptions.push(String(g.description).toLowerCase());
  }

  const gaps: Recommendation[] = [];

  for (const v of eligible) {
    const desc = v.description.toLowerCase();
    const costCode = v.cost_code || (v.layer_hint ? classifyLayer(v.layer_hint).cost_code : undefined);

    // If the cost code already exists in the ledger, treat as covered.
    if (costCode && seenCodes.has(costCode)) continue;
    // If a similar description already exists, treat as covered.
    if (seenDescs.some((d) => partialMatch(d, desc))) continue;

    const crossVerified = vecDescriptions.some((d) => partialMatch(d, desc));

    gaps.push({
      action: "insert_estimate_line",
      cross_verified: crossVerified,
      confidence: v.confidence,
      vision_source: v.source,
      raw_text: v.raw_text,
      item: {
        cost_code: costCode ?? null,
        description: v.description,
        quantity: v.quantity,
        unit: v.unit,
        labor_unit: 0,
        material_unit: 0,
        equipment_unit: 0,
        subcontractor_unit: 0,
        trucking_unit: 0,
        disposal_unit: 0,
        notes: v.raw_text ? `Detected from ${v.source}: "${v.raw_text.slice(0, 200)}"` : `Detected from ${v.source}`,
        source: `scope_gap_agent/${v.source}`,
      },
    });
  }

  if (gaps.length === 0) return { inserted: 0 };

  const severity = gaps.some((g) => g.confidence >= 0.85 && g.cross_verified) ? "critical" : "warning";

  const { error } = await db.from("ai_agent_audit_trails").insert([{
    tenant_id: tenantId,
    project_id: projectId,
    document_id: documentId,
    page_id: pageId,
    agent_name: "scope_gap_verifier",
    execution_trigger: "vision_extractions_updated",
    finding_summary:
      `${gaps.length} construction item${gaps.length === 1 ? " is" : "s are"} referenced on this sheet but missing from the estimate.`,
    recommendations: { gaps },
    severity,
    status: "pending_human_review",
  }]);
  if (error) throw new Error(`insert audit trail: ${error.message}`);
  return { inserted: gaps.length };
}

function partialMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b;
  const long  = a.length < b.length ? b : a;
  const window = short.slice(0, Math.max(12, Math.min(short.length, 30)));
  return long.includes(window);
}
