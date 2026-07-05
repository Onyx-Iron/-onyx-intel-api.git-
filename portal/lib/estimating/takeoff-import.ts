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
}

export interface TakeoffRowForSave extends TakeoffFingerprintInput {
  id?: string | null;
  rate?: number | null;
  page?: number | null;
  document_id?: string | null;
}

export interface ExistingEstimateForImport {
  source_takeoff_id?: string | null;
  source_fingerprint?: string | null;
  notes?: string | null;
}

export interface CostCatalogForImport {
  csi_code?: string | null;
  uom?: string | null;
  unit_cost?: number | null;
}

export interface EstimateImportRow {
  project_id: string;
  description: string;
  csi_code: string | null;
  trade: string | null;
  item_type: "material";
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
}

export interface BuildEstimateImportResult {
  rows: EstimateImportRow[];
  skipped: number;
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
  const existingKeys = new Set<string>();
  for (const item of input.existingEstimateItems) {
    if (item.source_takeoff_id) existingKeys.add(`id:${item.source_takeoff_id}`);
    if (item.source_fingerprint) existingKeys.add(`fp:${item.source_fingerprint}`);
    const fingerprint = fingerprintFromNotes(item.notes);
    if (fingerprint) existingKeys.add(`fp:${fingerprint}`);
  }

  const costLookup = buildCostLookup(input.costCatalog);
  const rows: EstimateImportRow[] = [];
  let skipped = 0;

  for (const takeoff of input.takeoffItems) {
    const fingerprint = takeoffFingerprint(takeoff);
    if (existingKeys.has(`id:${takeoff.id}`) || existingKeys.has(`fp:${fingerprint}`)) {
      skipped++;
      continue;
    }

    const description = cleanText(takeoff.label) ?? "Takeoff item";
    const csi = cleanText(takeoff.csi_code);
    const uom = cleanText(takeoff.unit)?.toUpperCase() ?? null;
    const unitCost = findUnitCost(costLookup, csi, uom);
    const quantityBasis = cleanText(takeoff.meta?.quantity_basis);
    const drawingRef = cleanText(takeoff.meta?.drawing_ref);
    const locationTag = cleanText(takeoff.meta?.location_tag);
    const aiVision = takeoff.meta?.extraction_method === "ai_vision";
    const notes = buildSourceNotes({ drawingRef, locationTag, quantityBasis, aiVision });

    rows.push({
      project_id: input.projectId,
      description,
      csi_code: csi,
      trade: cleanText(takeoff.meta?.trade),
      item_type: "material",
      quantity: takeoff.quantity ?? null,
      uom,
      unit_cost: unitCost,
      source_takeoff_id: takeoff.id,
      source_fingerprint: fingerprint,
      quantity_basis: quantityBasis,
      drawing_ref: drawingRef,
      location_tag: locationTag,
      pricing_status: aiVision ? "review" : unitCost != null ? "priced" : "unpriced",
      notes,
    });
  }

  return { rows, skipped };
}

function buildCostLookup(catalog: CostCatalogForImport[]): Map<string, number> {
  const lookup = new Map<string, number>();
  for (const item of catalog) {
    const cost = item.unit_cost ?? null;
    const csi = cleanText(item.csi_code);
    if (!csi || cost == null || cost <= 0) continue;
    const uom = cleanText(item.uom)?.toUpperCase();
    if (uom && !lookup.has(`${csi}|${uom}`)) lookup.set(`${csi}|${uom}`, cost);
    if (!lookup.has(`${csi}|*`)) lookup.set(`${csi}|*`, cost);
  }
  return lookup;
}

function findUnitCost(lookup: Map<string, number>, csi: string | null, uom: string | null): number | null {
  if (!csi) return null;
  if (uom && lookup.has(`${csi}|${uom}`)) return lookup.get(`${csi}|${uom}`) ?? null;
  if (lookup.has(`${csi}|*`)) return lookup.get(`${csi}|*`) ?? null;
  // Fall back to 2-char division prefix (allows seeding with division-level rates)
  const div = csi.replace(/-/g, "").slice(0, 2);
  if (uom && lookup.has(`${div}|${uom}`)) return lookup.get(`${div}|${uom}`) ?? null;
  return lookup.get(`${div}|*`) ?? null;
}

function buildSourceNotes({
  drawingRef,
  locationTag,
  quantityBasis,
  aiVision,
}: {
  drawingRef: string | null;
  locationTag: string | null;
  quantityBasis: string | null;
  aiVision?: boolean;
}): string {
  const visible = [
    aiVision ? "Review required: AI vision quantity" : null,
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
