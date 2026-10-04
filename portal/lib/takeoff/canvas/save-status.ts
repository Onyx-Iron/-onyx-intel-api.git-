export interface SaveStatusInput {
  unsaved: number;
  saving: boolean;
  conflict: boolean;
  scaleUnconfirmed: boolean;
  outboxFailed: number;
  outboxCompleted: number;
}

/** One line for the sheet: the latest thing standing between the drawing and the estimate. */
export function saveStatusLine(input: SaveStatusInput): string {
  if (input.saving) return "Saving";
  if (input.conflict) return "Conflict";
  if (input.unsaved > 0) return "Unsaved";
  if (input.scaleUnconfirmed) return "Scale not confirmed";
  if (input.outboxFailed > 0) return "Estimate sync pending";
  if (input.outboxCompleted > 0) return "Estimate sync complete";
  return "Saved";
}
