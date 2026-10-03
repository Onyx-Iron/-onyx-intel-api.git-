/**
 * Turns a national unit price into a regional one when a published location
 * index exists. A factor near 1.0 is refused: that is still a general number.
 * A broken index is refused instead of inventing a price.
 */

export const LOCATION_INDEX_MAX_AGE_DAYS = 540;
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2;
const NATIONAL_BAND = 0.02;

const NATIONAL_REGIONS = new Set(["US", "USA", "NATIONAL", "US-NATIONAL"]);
const LOCATION_SERIES = new Set(["location", "cci", "lci"]);
const LOCATION_SOURCES = new Set(["enr_cci", "rsmeans_lci", "location_factor"]);

export interface LocationIndexRow {
  regionCode: string;
  indexValue: number;
  baseValue?: number | null;
  observedAt?: string | null;
  seriesCode?: string | null;
  source?: string | null;
}

export interface LocationFactor {
  factor: number;
  regionCode: string;
  observedAt: string | null;
  detail: string;
}

export function isLocationIndex(row: { seriesCode?: string | null; source?: string | null }): boolean {
  const series = (row.seriesCode ?? "").trim().toLowerCase();
  const source = (row.source ?? "").trim().toLowerCase();
  return LOCATION_SERIES.has(series) || LOCATION_SOURCES.has(source);
}

export function scaleMoney(value: number, factor: number): number {
  return Math.round(value * factor * 100) / 100;
}

function ageDays(observedAt: string | null | undefined, now: Date): number | null {
  if (!observedAt) return null;
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

function newest(rows: LocationIndexRow[], now: Date): LocationIndexRow | null {
  const fresh = rows.filter((row) => {
    const age = ageDays(row.observedAt, now);
    return Number.isFinite(row.indexValue) && row.indexValue > 0 && age != null && age <= LOCATION_INDEX_MAX_AGE_DAYS;
  });
  fresh.sort((a, b) => Date.parse(b.observedAt ?? "") - Date.parse(a.observedAt ?? ""));
  return fresh[0] ?? null;
}

/**
 * Regional index ÷ national index, or index ÷ its own base when the row
 * already stores the national base. Returns null when the result would
 * still be a national number or the index is unusable.
 */
export function selectLocationFactor(args: {
  rows: LocationIndexRow[];
  regionCandidates: string[];
  now?: Date;
}): LocationFactor | null {
  const now = args.now ?? new Date();
  const rows = args.rows.filter(isLocationIndex);
  const national = newest(
    rows.filter((row) => NATIONAL_REGIONS.has(row.regionCode.trim().toUpperCase())),
    now,
  );

  for (const candidate of args.regionCandidates) {
    const key = candidate.trim().toUpperCase();
    if (!key || NATIONAL_REGIONS.has(key)) continue;
    const regional = newest(
      rows.filter((row) => row.regionCode.trim().toUpperCase() === key),
      now,
    );
    if (!regional) continue;

    const base = regional.baseValue != null && regional.baseValue > 0
      ? regional.baseValue
      : national && national.indexValue > 0
        ? national.indexValue
        : null;
    if (base == null) continue;

    const factor = regional.indexValue / base;
    if (!Number.isFinite(factor) || factor < MIN_FACTOR || factor > MAX_FACTOR) continue;
    if (Math.abs(factor - 1) < NATIONAL_BAND) continue;

    const rounded = Math.round(factor * 10_000) / 10_000;
    return {
      factor: rounded,
      regionCode: regional.regionCode,
      observedAt: regional.observedAt ?? null,
      detail: `Location index ${regional.regionCode} ${regional.indexValue} / ${base} = ${rounded}`,
    };
  }
  return null;
}
