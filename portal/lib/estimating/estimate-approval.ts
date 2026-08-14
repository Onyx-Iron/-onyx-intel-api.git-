import { calculateEstimateTotals } from "./calculations";
import { buildEstimateQualityReport } from "./estimate-qc";

type EstimateVersionApprovalInput = {
  id: string;
  estimate_id: string;
  project_id: string;
  row_version: number;
  status: string;
  contingency_pct: number | null;
  overhead_pct: number | null;
  profit_pct: number | null;
};

function priceApprovalStatus(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const status = (snapshot as Record<string, unknown>).approval_status;
  return typeof status === "string" ? status : null;
}

export function buildEstimateApprovalPayload(
  version: EstimateVersionApprovalInput,
  items: Array<Record<string, unknown>>,
) {
  const sortedItems = [...items].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const quality = buildEstimateQualityReport(sortedItems.map((item) => ({
    id: String(item.id),
    description: typeof item.description === "string" ? item.description : null,
    csi_code: typeof item.csi_code === "string" ? item.csi_code : null,
    trade: typeof item.trade === "string" ? item.trade : null,
    item_type: typeof item.item_type === "string" ? item.item_type : null,
    quantity: typeof item.quantity === "number" ? item.quantity : null,
    uom: typeof item.uom === "string" ? item.uom : null,
    unit_cost: typeof item.unit_price === "number" ? item.unit_price : null,
    source_takeoff_id: typeof item.source_takeoff_id === "string" ? item.source_takeoff_id : null,
    source_fingerprint: typeof item.source_fingerprint === "string" ? item.source_fingerprint : null,
    quantity_basis: typeof item.quantity_basis === "string" ? item.quantity_basis : null,
    drawing_ref: typeof item.drawing_ref === "string" ? item.drawing_ref : null,
    location_tag: typeof item.location_tag === "string" ? item.location_tag : null,
    pricing_status: typeof item.pricing_status === "string" ? item.pricing_status : null,
    price_observation_id: typeof item.price_observation_id === "string" ? item.price_observation_id : null,
    price_approval_status: priceApprovalStatus(item.price_source_snapshot),
  })));
  const totals = calculateEstimateTotals(sortedItems.map((item) => ({
    totalDirectCost: Number(item.total_direct_cost ?? 0),
    indirectCost: Number(item.indirect_cost ?? 0),
    contingency: Number(item.contingency ?? 0),
    overhead: Number(item.overhead ?? 0),
    profit: Number(item.profit ?? 0),
    totalPrice: Number(item.total_price ?? 0),
    isAlternate: Boolean(item.is_alternate),
    alternateAccepted: Boolean(item.alternate_accepted),
  })));
  return {
    estimateId: version.estimate_id,
    projectId: version.project_id,
    versionId: version.id,
    versionRevision: version.row_version,
    versionStatus: version.status,
    settings: {
      contingencyPct: version.contingency_pct,
      overheadPct: version.overhead_pct,
      profitMarkupPct: version.profit_pct,
    },
    items: sortedItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unit: item.uom,
      totalDirectCost: item.total_direct_cost,
      totalPrice: item.total_price,
      sourceTakeoffId: item.source_takeoff_id ?? null,
      sourceFingerprint: item.source_fingerprint ?? null,
      priceObservationId: item.price_observation_id ?? null,
      priceSourceSnapshot: item.price_source_snapshot ?? null,
    })),
    totals,
    quality,
  };
}
