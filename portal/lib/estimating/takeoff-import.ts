import { type EstimateLineType } from "./csi-catalog";

export interface TakeoffFingerprintInput {
  id?: string | null;
  label?: string | null;
  csi_code?: string | null;
  division?: string | null;
  quantity?: number | null;
  unit?: string | null;
  type?: string | null;
  meta?: {
    trade?: string | null;
    quantity_basis?: string | null;
    drawing_ref?: string | null;
    location_tag?: string | null;
    [key: string]: unknown;
  } | null;
}

export interface TakeoffItemForEstimate extends TakeoffFingerprintInput {
  id: string;
  // Canonical 4-state lifecycle: suggested -> reviewed -> approved | rejected.
  // Only 'approved' may flow into the estimate — 'suggested' and 'reviewed'
  // are both still unapproved (an estimator has looked at a 'reviewed' item
  // but has not yet made an approve/reject decision), and 'rejected' is
  // permanent. Missing/null is treated as 'approved' for backward
  // compatibility with rows inserted before this column existed (the
  // migration backfills existing rows to 'approved' via its column
  // default, so this fallback is a belt-and-suspenders match).
  review_status?: "suggested" | "reviewed" | "approved" | "rejected" | null;
  source_method?: string | null;
}

export interface TakeoffRowForSave extends TakeoffFingerprintInput {
  id?: string | null;
  rate?: number | null;
  page?: number | null;
  document_id?: string | null;
}

export interface ExistingEstimateForImport {
  id?: string | null;
  estimate_version_id?: string | null;
  source_takeoff_id?: string | null;
  source_fingerprint?: string | null;
  notes?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
}

export interface CostCatalogForImport {
  csi_code?: string | null;
  uom?: string | null;
  unit_cost?: number | null;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  confidence?: "high" | "medium" | "low" | null;
  /** section = this CSI code and unit. location_index = national price moved by a regional index. national = US average only. */
  basis?: "section" | "location_index" | "national" | null;
}

export interface EstimateImportRow {
  project_id: string;
  description: string;
  csi_code: string | null;
  trade: string | null;
  item_type: EstimateLineType;
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  quantity: number | null;
  uom: string | null;
  unit_cost: number | null;
  source_takeoff_id: string;
  source_fingerprint: string;
  quantity_basis: string | null;
  drawing_ref: string | null;
  location_tag: string | null;
  pricing_status: "priced" | "unpriced" | "review";
  notes: string;
}

export interface BuildEstimateImportInput {
  takeoffItems: TakeoffItemForEstimate[];
  existingEstimateItems: ExistingEstimateForImport[];
  costCatalog: CostCatalogForImport[];
  projectId: string;
  // When set, a takeoff quantity (or other fingerprint) change updates the
  // matching line on this version only. Lines on any other version are left
  // untouched, so an approved snapshot cannot be rewritten.
  targetVersionId?: string | null;
}

export interface EstimateImportUpdate {
  estimateItemId: string;
  existing: ExistingEstimateForImport;
  row: EstimateImportRow;
}

export interface BuildEstimateImportResult {
  rows: EstimateImportRow[];
  updates: EstimateImportUpdate[];
  skipped: number;
  // Count of takeoff items that exist but were excluded specifically
  // because they aren't approved yet (pending_review or rejected) —
  // distinct from `skipped` (already-imported duplicates), so callers can
  // tell "nothing new" apart from "new items exist but need review".
  blockedByReview: number;
}

export interface ScaledDirectCosts {
  unitCost: number;
  laborCost: number;
  materialCost: number;
  equipmentCost: number;
}

/**
 * Keeps an estimator's unit price and labor/material/equipment split, and
 * scales the extended costs to the new quantity. Returns null when there is
 * no unit price to preserve, so the caller can price from the catalog instead.
 */
export function scaledDirectCosts(
  existing: ExistingEstimateForImport,
  newQuantity: number | null,
): ScaledDirectCosts | null {
  const unitCost = existing.unit_cost;
  const oldQuantity = existing.quantity;
  if (
    unitCost == null ||
    oldQuantity == null ||
    !Number.isFinite(oldQuantity) ||
    oldQuantity === 0 ||
    newQuantity == null ||
    !Number.isFinite(newQuantity)
  ) {
    return null;
  }
  const factor = newQuantity / oldQuantity;
  return {
    unitCost,
    laborCost: (existing.labor_cost ?? 0) * factor,
    materialCost: (existing.material_cost ?? 0) * factor,
    equipmentCost: (existing.equipment_cost ?? 0) * factor,
  };
}

export function takeoffFingerprint(item: TakeoffFingerprintInput): string {
  const parts = [
    normalizeText(item.label),
    normalizeText(item.csi_code),
    normalizeNumber(item.quantity),
    normalizeText(item.unit),
    normalizeText(item.meta?.drawing_ref),
    normalizeText(item.meta?.location_tag),
  ];
  return parts.join("|");
}

export function prepareTakeoffRowsForSave(
  rows: TakeoffRowForSave[],
  existingRows: TakeoffFingerprintInput[],
): { rows: TakeoffRowForSave[]; skipped: number } {
  const existingFingerprints = new Set<string>();
  for (const existing of existingRows) {
    const stored = typeof existing.meta?.source_fingerprint === "string" ? existing.meta.source_fingerprint : null;
    if (stored) existingFingerprints.add(stored);
    existingFingerprints.add(takeoffFingerprint(existing));
  }

  const prepared: TakeoffRowForSave[] = [];
  let skipped = 0;

  for (const row of rows) {
    const fingerprint = takeoffFingerprint(row);
    if (existingFingerprints.has(fingerprint)) {
      skipped++;
      continue;
    }

    existingFingerprints.add(fingerprint);
    prepared.push({
      ...row,
      meta: {
        ...(row.meta ?? {}),
        source_fingerprint: fingerprint,
      },
    });
  }

  return { rows: prepared, skipped };
}

export function buildEstimateImportRows(input: BuildEstimateImportInput): BuildEstimateImportResult {
  const fingerprintKeys = new Set<string>();
  const idKeys = new Set<string>();
  for (const item of input.existingEstimateItems) {
    if (item.source_takeoff_id) idKeys.add(item.source_takeoff_id);
    const fingerprint = existingFingerprint(item);
    if (fingerprint) fingerprintKeys.add(fingerprint);
  }

  const costLookup = buildCostLookup(input.costCatalog);
  const rows: EstimateImportRow[] = [];
  const updates: EstimateImportUpdate[] = [];
  let skipped = 0;
  let blockedByReview = 0;

  for (const takeoff of input.takeoffItems) {
    const fingerprint = takeoffFingerprint(takeoff);
    const aiVision = takeoff.meta?.extraction_method === "ai_vision" || takeoff.source_method === "ai_vision";
    const manual = takeoff.source_method === "manual" || takeoff.meta?.extraction_method === "manual";
    if (takeoff.review_status == null && !manual) {
      blockedByReview++;
      continue;
    }
    if (aiVision && takeoff.review_status !== "approved") {
      blockedByReview++;
      continue;
    }
    // Hard gate: only 'approved' items may reach the estimate. 'suggested'
    // and 'reviewed' are both still unapproved — a human having looked at
    // an item (reviewed) is not the same as having approved it — and
    // 'rejected' is permanent. This is the actual enforcement point for
    // "unapproved AI quantities cannot affect approved estimate totals":
    // a status column alone (pricing_status: "review") is advisory, not a
    // gate; excluding the row from ever being inserted is the gate.
    if (takeoff.review_status === "suggested" || takeoff.review_status === "reviewed" || takeoff.review_status === "rejected") {
      blockedByReview++;
      continue;
    }

    const draftItem = input.targetVersionId
      ? input.existingEstimateItems.find((item) =>
          Boolean(item.id) &&
          item.estimate_version_id === input.targetVersionId &&
          item.source_takeoff_id === takeoff.id)
      : undefined;

    if (draftItem?.id) {
      if (existingFingerprint(draftItem) === fingerprint) {
        skipped++;
        continue;
      }
      updates.push({
        estimateItemId: draftItem.id,
        existing: draftItem,
        row: toImportRow(input.projectId, takeoff, fingerprint, costLookup),
      });
      fingerprintKeys.add(fingerprint);
      continue;
    }

    if (fingerprintKeys.has(fingerprint) || (!input.targetVersionId && idKeys.has(takeoff.id))) {
      skipped++;
      continue;
    }

    if (input.targetVersionId && idKeys.has(takeoff.id)) {
      const unchangedOnAnotherVersion = input.existingEstimateItems.some((item) =>
        item.source_takeoff_id === takeoff.id && existingFingerprint(item) === fingerprint);
      if (unchangedOnAnotherVersion) {
        skipped++;
        continue;
      }
    }

    rows.push(toImportRow(input.projectId, takeoff, fingerprint, costLookup));
    fingerprintKeys.add(fingerprint);
    idKeys.add(takeoff.id);
  }

  return { rows, updates, skipped, blockedByReview };
}

function existingFingerprint(item: ExistingEstimateForImport): string | null {
  return item.source_fingerprint || fingerprintFromNotes(item.notes);
}

function toImportRow(
  projectId: string,
  takeoff: TakeoffItemForEstimate,
  fingerprint: string,
  costLookup: Map<string, CatalogRate>,
): EstimateImportRow {
  const description = cleanText(takeoff.label) ?? "Takeoff item";
  const csi = cleanText(takeoff.csi_code);
  const uom = cleanText(takeoff.unit)?.toUpperCase() ?? null;
  const matched = findUnitCost(costLookup, csi, uom);
  const unitCost = matched?.unitCost ?? null;
  const quantityBasis = cleanText(takeoff.meta?.quantity_basis);
  const drawingRef = cleanText(takeoff.meta?.drawing_ref);
  const locationTag = cleanText(takeoff.meta?.location_tag);
  const aiVision = takeoff.meta?.extraction_method === "ai_vision";
  const notes = buildSourceNotes({ drawingRef, locationTag, quantityBasis, aiVision, rateNote: matched?.note ?? null });
  const pricingStatus = unitCost == null
    ? "unpriced"
    : aiVision || matched?.basis === "national" || matched?.confidence === "low"
      ? "review"
      : "priced";

  return {
    project_id: projectId,
    description,
    csi_code: csi,
    trade: cleanText(takeoff.meta?.trade),
    item_type: lineTypeFromSplit(matched?.laborCost, matched?.materialCost, matched?.equipmentCost),
    labor_cost: matched?.laborCost ?? null,
    material_cost: matched?.materialCost ?? null,
    equipment_cost: matched?.equipmentCost ?? null,
    quantity: takeoff.quantity ?? null,
    uom,
    unit_cost: unitCost,
    source_takeoff_id: takeoff.id,
    source_fingerprint: fingerprint,
    quantity_basis: quantityBasis,
    drawing_ref: drawingRef,
    location_tag: locationTag,
    pricing_status: pricingStatus,
    notes,
  };
}

const UNIT_FAMILY: Record<string, string> = {
  LF: "LF", FT: "LF", FEET: "LF", FOOT: "LF",
  SF: "SF", SQFT: "SF",
  SY: "SY",
  CY: "CY",
  EA: "EA", EACH: "EA",
  TON: "TON", TN: "TON",
  LS: "LS",
  AC: "AC", ACRE: "AC",
};

interface CatalogRate {
  unitCost: number;
  basis: "section" | "location_index" | "national";
  unit: string | null;
  laborCost: number | null;
  materialCost: number | null;
  equipmentCost: number | null;
  confidence: "high" | "medium" | "low" | null;
}

function lineTypeFromSplit(labor?: number | null, material?: number | null, equipment?: number | null): EstimateLineType {
  const parts: Array<{ type: EstimateLineType; value: number }> = [
    { type: "labour", value: labor ?? 0 },
    { type: "material", value: material ?? 0 },
    { type: "equipment", value: equipment ?? 0 },
  ];
  const best = parts.reduce((current, next) => next.value > current.value ? next : current);
  return best.value > 0 ? best.type : "material";
}

function csiDigits(code: string): string {
  return code.replace(/\D/g, "");
}

export function unitsCompatible(rateUnit: string | null | undefined, quantityUnit: string | null | undefined): boolean {
  const rate = unitFamily(cleanText(rateUnit));
  const quantity = unitFamily(cleanText(quantityUnit));
  if (!rate || !quantity) return false;
  return rate === quantity;
}

function unitFamily(unit: string | null): string | null {
  if (!unit) return null;
  const key = unit.toUpperCase().replace(/\./g, "").replace(/\s+/g, "");
  return UNIT_FAMILY[key] ?? key;
}

function basisRank(basis: CatalogRate["basis"]): number {
  if (basis === "section") return 3;
  if (basis === "location_index") return 2;
  return 1;
}

function buildCostLookup(catalog: CostCatalogForImport[]): Map<string, CatalogRate> {
  const lookup = new Map<string, CatalogRate>();
  for (const item of catalog) {
    const cost = item.unit_cost ?? null;
    const csi = cleanText(item.csi_code);
    if (!csi || cost == null || cost <= 0) continue;
    const basis: CatalogRate["basis"] = item.basis === "national" || item.basis === "location_index" ? item.basis : "section";
    const family = unitFamily(cleanText(item.uom));
    const key = `${csiDigits(csi)}|${family ?? ""}`;
    const current = lookup.get(key);
    const next: CatalogRate = {
      unitCost: cost,
      basis,
      unit: family,
      laborCost: item.labor_cost ?? null,
      materialCost: item.material_cost ?? null,
      equipmentCost: item.equipment_cost ?? null,
      confidence: item.confidence ?? null,
    };
    if (!current || basisRank(next.basis) > basisRank(current.basis)) lookup.set(key, next);
  }
  return lookup;
}

function findUnitCost(
  lookup: Map<string, CatalogRate>,
  csi: string | null,
  uom: string | null,
): { unitCost: number | null; basis: CatalogRate["basis"] | null; note: string | null; laborCost: number | null; materialCost: number | null; equipmentCost: number | null; confidence: CatalogRate["confidence"] } | null {
  if (!csi) return null;
  const digits = csiDigits(csi);
  if (!digits) return null;
  const family = unitFamily(uom);
  const exact = lookup.get(`${digits}|${family ?? ""}`);
  if (exact) {
    return {
      unitCost: exact.unitCost,
      basis: exact.basis,
      laborCost: exact.laborCost,
      materialCost: exact.materialCost,
      equipmentCost: exact.equipmentCost,
      confidence: exact.confidence,
      note: exact.basis === "national"
        ? "National average only. Confirm a local rate before this line enters the sell price."
        : exact.basis === "location_index"
          ? "National price adjusted by this region's location index."
          : null,
    };
  }
  const otherUnits = [...new Set(
    [...lookup.entries()]
      .filter(([key]) => key.startsWith(`${digits}|`) && key.slice(digits.length + 1) !== (family ?? ""))
      .map(([, rate]) => rate.unit)
      .filter((unit): unit is string => Boolean(unit)),
  )];
  if (family && otherUnits.length > 0) {
    return {
      unitCost: null,
      basis: null,
      laborCost: null,
      materialCost: null,
      equipmentCost: null,
      confidence: null,
      note: `A rate is on file for ${otherUnits.join(", ")}, not ${family}. The other unit was not applied.`,
    };
  }
  return null;
}

function buildSourceNotes({
  drawingRef,
  locationTag,
  quantityBasis,
  aiVision,
  rateNote,
}: {
  drawingRef: string | null;
  locationTag: string | null;
  quantityBasis: string | null;
  aiVision?: boolean;
  rateNote?: string | null;
}): string {
  const visible = [
    aiVision ? "Review required: AI vision quantity" : null,
    rateNote,
    drawingRef ? `Source: ${drawingRef}` : null,
    locationTag ? `Location: ${locationTag}` : null,
    quantityBasis ? `Basis: ${quantityBasis}` : null,
  ].filter(Boolean);

  return visible.length > 0 ? visible.join(" | ") : "Source: takeoff import";
}

function fingerprintFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/\[onyx_takeoff_fingerprint:([^\]]+)\]/);
  return match?.[1] ?? null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function normalizeText(value: unknown): string {
  return cleanText(value)?.toLowerCase().replace(/\s+/g, " ") ?? "";
}

function normalizeNumber(value: unknown): string {
  if (value == null || value === "") return "";
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}
