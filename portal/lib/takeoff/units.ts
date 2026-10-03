/**
 * Unit-system display layer. Takeoff math stays in feet / SF / CF internally;
 * these helpers convert only at UI / export edges so toggling systems never
 * rewrites stored geometry.
 */

export type UnitSystem = "imperial" | "metric";

export const M_PER_FT = 0.3048;
export const M2_PER_SF = 0.09290304;
export const M3_PER_CF = 0.028316846592;
export const MM_PER_IN = 25.4;

export const areaVal = (sf: number, units: UnitSystem): number =>
  units === "metric" ? sf * M2_PER_SF : sf;
export const areaUnit = (units: UnitSystem): string => (units === "metric" ? "m²" : "SF");

export const lenVal = (lf: number, units: UnitSystem): number =>
  units === "metric" ? lf * M_PER_FT : lf;
export const lenUnit = (units: UnitSystem): string => (units === "metric" ? "m" : "LF");

/** Calibration / dimension typed input → internal feet. */
export const calInputToFeet = (v: number, units: UnitSystem): number =>
  units === "metric" ? v / M_PER_FT : v;

export const volVal = (cf: number, units: UnitSystem): number =>
  units === "metric" ? cf * M3_PER_CF : cf / 27;
export const volUnit = (units: UnitSystem): string => (units === "metric" ? "m³" : "CY");

/** Feet → drawing-style feet-and-inches: 12.51 → "12′-6″" (nearest inch). */
export function ftIn(feet: number): string {
  if (!Number.isFinite(feet)) return "";
  const sign = feet < 0 ? "-" : "";
  let ft = Math.floor(Math.abs(feet) + 1e-9);
  let inch = Math.round((Math.abs(feet) - ft) * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return `${sign}${ft}′-${inch}″`;
}

/**
 * Parse a typed length into internal feet.
 * Imperial: decimal feet, feet-inches ("12'6", "12-6"), inches-only ("6\"").
 * Metric: meters.
 */
export function parseLenInput(raw: string, units: UnitSystem): number {
  const s = (raw || "").trim();
  if (!s) return NaN;
  const plainNum = (t: string): number => (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t) ? Number(t) : NaN);
  if (units === "metric") {
    const m = plainNum(s.replace(/m$/i, "").trim());
    return Number.isFinite(m) ? m / M_PER_FT : NaN;
  }
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|″|”|in)$/i);
  if (inOnly) return Number(inOnly[1]) / 12;
  const fi =
    s.match(/^(\d+(?:\.\d+)?)\s*(?:'|′|’|ft)\s*(?:-|\s)?\s*(\d+(?:\.\d+)?)?\s*(?:"|″|”|in)?$/i) ||
    s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (fi) {
    const ft = Number(fi[1]);
    const inch = fi[2] != null ? Number(fi[2]) : 0;
    if (!Number.isFinite(ft) || !Number.isFinite(inch) || inch >= 12) return NaN;
    return ft + inch / 12;
  }
  return plainNum(s);
}
