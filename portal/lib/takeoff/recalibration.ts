export interface RecalibrationMeasurement {
  id: string;
  label?: string | null;
  takeoff_type: string;
  quantity: number;
  unit?: string | null;
}

export interface RecalibrationPreviewLine {
  id: string;
  label: string;
  takeoff_type: string;
  unit: string | null;
  before: number;
  after: number;
  /** False when the old scale cannot recompute this quantity. */
  recomputed: boolean;
}

/**
 * Scale draft measurements from an old page-space factor to a new one.
 * Area scales with the square of the ratio. Counts do not change.
 * A missing old factor does not invent a new quantity.
 */
export function previewRecalibration(
  items: RecalibrationMeasurement[],
  oldFactor: number | null,
  newFactor: number,
): RecalibrationPreviewLine[] {
  const canScale = oldFactor != null && oldFactor > 0 && Number.isFinite(newFactor) && newFactor > 0;
  const ratio = canScale ? newFactor / (oldFactor as number) : 1;
  return items.map((item) => {
    let after = item.quantity;
    let recomputed = false;
    const linear = item.takeoff_type === "length" || item.takeoff_type === "perimeter" || item.takeoff_type === "perim";
    if (canScale && linear) {
      after = item.quantity * ratio;
      recomputed = true;
    } else if (canScale && item.takeoff_type === "area") {
      after = item.quantity * ratio * ratio;
      recomputed = true;
    }
    return {
      id: item.id,
      label: item.label?.trim() || item.takeoff_type,
      takeoff_type: item.takeoff_type,
      unit: item.unit ?? null,
      before: item.quantity,
      after,
      recomputed,
    };
  });
}

export function recalibrationNeedsConfirm(lines: RecalibrationPreviewLine[]): boolean {
  return lines.some((line) => line.recomputed && Math.abs(line.after - line.before) > 1e-6);
}

export interface RecalibrationWriteFailure {
  id: string;
  reason: string;
}

export interface CommitRecalibratedDraftsResult {
  updated: number;
  failures: RecalibrationWriteFailure[];
  /** Set when at least one quantity changed and the draft estimate sync threw. */
  estimateError: string | null;
}

/**
 * Writes each recomputed draft quantity, then syncs the draft estimate in
 * the same request. The outbox row written by the quantity update is only
 * drained by the daily cron unless this sync runs now.
 */
export async function commitRecalibratedDrafts(args: {
  lines: RecalibrationPreviewLine[];
  write: (line: RecalibrationPreviewLine) => Promise<{ ok: true } | { ok: false; reason: string }>;
  syncEstimate: () => Promise<void>;
}): Promise<CommitRecalibratedDraftsResult> {
  const failures: RecalibrationWriteFailure[] = [];
  let updated = 0;
  for (const line of args.lines) {
    if (!line.recomputed) continue;
    try {
      const result = await args.write(line);
      if (result.ok) updated++;
      else failures.push({ id: line.id, reason: result.reason });
    } catch (err) {
      failures.push({ id: line.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  let estimateError: string | null = null;
  if (updated > 0) {
    try {
      await args.syncEstimate();
    } catch (err) {
      estimateError = err instanceof Error ? err.message : String(err);
    }
  }
  return { updated, failures, estimateError };
}
