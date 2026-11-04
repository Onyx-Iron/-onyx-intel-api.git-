/** Bounds the processing-timeline page size. Missing or non-numeric values use 80. */
export function clampProcessingEventLimit(raw: string | null): number {
  const limitRaw = Number(raw ?? "80");
  return Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 80;
}
