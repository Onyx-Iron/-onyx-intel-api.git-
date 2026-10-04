/** City, metro, and state spellings that should hit the same region_code row. */
export function normalizeRegionToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const key = trimmed.toLowerCase().replace(/\./g, "");
  const aliases: Record<string, string> = {
    "st louis": "St. Louis",
    "saint louis": "St. Louis",
  };
  if (aliases[key]) return aliases[key];
  return trimmed
    .replace(/\./g, "")
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\bSt\b/g, "St.");
}

export function regionCodeAliases(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  const raw = value.trim().replace(/\s+/g, " ");
  const normalized = normalizeRegionToken(raw);
  const compact = raw.replace(/\./g, "");
  const dotted = compact.replace(/\bSt\b/i, "St.");
  return [...new Set([raw, normalized, compact, dotted].filter((item): item is string => Boolean(item)))];
}
