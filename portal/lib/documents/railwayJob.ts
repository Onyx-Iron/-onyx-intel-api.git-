/**
 * Pure decisions for the Railway Celery CAD/IFC extract job.
 *
 * upload-url/complete enqueues the job and stores railway_job_id, but nothing
 * used to read GET /api/jobs/:id. These helpers decide whether a poll should
 * import rows, fail the document, or keep waiting.
 */

export const RAILWAY_PROCESSING_KIND = "railway_celery";

/** Hard cap for a queued or running CAD extract before the document is failed. */
export const RAILWAY_EXTRACT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export interface RailwayJobSnapshot {
  status?: string | null;
  ready?: boolean | null;
  successful?: boolean | null;
  error?: string | null;
  result?: unknown;
}

export interface ExtractedTakeoffRow {
  description: string;
  quantity: number | null;
  unit: string | null;
  cost_code: string | null;
  trade: string | null;
  quantity_basis: string | null;
  drawing_ref: string | null;
  location_tag: string | null;
}

export type RailwayDecision =
  | { action: "import"; rows: ExtractedTakeoffRow[]; sourceType: string | null }
  | { action: "fail"; error: string }
  | { action: "wait" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Map a Celery extract_document result into takeoff rows. Null when the payload is unusable. */
export function rowsFromExtractResult(result: unknown): { rows: ExtractedTakeoffRow[]; sourceType: string | null } | null {
  const record = asRecord(result);
  if (!record) return null;
  const sourceType = asString(record.source_type);
  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  const rows: ExtractedTakeoffRow[] = [];
  for (const raw of rawRows) {
    const row = asRecord(raw);
    if (!row) continue;
    rows.push({
      description: asString(row.description) ?? asString(row.label) ?? "Untitled item",
      quantity: asQuantity(row.total_qty ?? row.quantity),
      unit: asString(row.uom) ?? asString(row.unit),
      cost_code: asString(row.cost_code),
      trade: asString(row.trade),
      quantity_basis: asString(row.quantity_basis),
      drawing_ref: asString(row.drawing_ref),
      location_tag: asString(row.location_tag),
    });
  }
  return { rows, sourceType };
}

export function interpretRailwayJob(
  job: RailwayJobSnapshot,
  enqueuedAt: string | null,
  now: Date = new Date(),
): RailwayDecision {
  const status = (job.status ?? "").trim().toLowerCase();
  const succeeded = status === "success" || (job.ready === true && job.successful === true);
  const failed = status === "failure" || status === "revoked" || (job.ready === true && job.successful === false);

  if (succeeded) {
    const parsed = rowsFromExtractResult(job.result);
    if (!parsed) {
      return { action: "fail", error: "CAD extraction finished without a result payload." };
    }
    return { action: "import", rows: parsed.rows, sourceType: parsed.sourceType };
  }

  if (failed) {
    const detail = asString(job.error) ?? "CAD extraction failed.";
    return { action: "fail", error: detail };
  }

  if (enqueuedAt) {
    const started = Date.parse(enqueuedAt);
    if (Number.isFinite(started) && now.getTime() - started >= RAILWAY_EXTRACT_TIMEOUT_MS) {
      return {
        action: "fail",
        error: "CAD extraction timed out before the worker reported a result. Retry the upload.",
      };
    }
  }

  return { action: "wait" };
}
