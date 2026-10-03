/** Digits only, so 03 30 00, 03-30-00, and 033000 are the same MasterFormat code. */
function codeKey(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** CSI codes present on takeoff that have no priced catalog row. */
export function missingPriceCodes(takeoffCodes: Array<string | null | undefined>, pricedCodes: Iterable<string>): string[] {
  const priced = new Set<string>();
  for (const code of pricedCodes) {
    const key = codeKey(code);
    if (key) priced.add(key);
  }
  const missing = new Map<string, string>();
  for (const code of takeoffCodes) {
    const label = (code ?? "").trim();
    const key = codeKey(label);
    if (!key || priced.has(key) || missing.has(key)) continue;
    missing.set(key, label);
  }
  return [...missing.values()].sort((a, b) => a.localeCompare(b));
}
