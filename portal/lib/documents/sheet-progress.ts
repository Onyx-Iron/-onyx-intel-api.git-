/** Copy for the canvas empty state while a plan is still splitting. */
export function sheetProgressCopy(ready: number, expected: number): string | null {
  if (ready <= 0 && expected <= 0) return null;
  if (expected > 0) return `${ready} of ${expected} sheets ready`;
  return `${ready} sheet${ready === 1 ? "" : "s"} ready`;
}
