function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** CSI codes present on takeoff that have no priced catalog row. */
export function missingPriceCodes(takeoffCodes: Array<string | null | undefined>, pricedCodes: Iterable<string>): string[] {
  const priced = new Set<string>();
  for (const code of pricedCodes) {
    const normalized = normalizeCode(code);
    if (normalized) priced.add(normalized);
  }
  const missing = new Set<string>();
  for (const code of takeoffCodes) {
    const normalized = normalizeCode(code);
    if (!normalized || priced.has(normalized)) continue;
    missing.add(normalized);
  }
  return [...missing].sort();
}
