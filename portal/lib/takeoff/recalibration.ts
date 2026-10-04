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
