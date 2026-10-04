/**
 * Printed sheet scales → feet per PDF point.
 *
 * PDF user space is 72 points to one inch of paper. A declaration such as
 * `1" = 20'` or `1/8" = 1'-0"` or `1:100` converts that paper inch into real
 * feet. The result is `page_space_scale_factor`: real feet per page-space unit,
 * the same factor `calculateLinearLength` and `calculatePolygonArea` use.
 * A missing or unreadable scale is null. Nothing here guesses a factor.
 */

export const PDF_POINTS_PER_INCH = 72;

export interface PrintedScale {
  scaleText: string;
  /** Real-world feet per PDF user-space point. */
  pageSpaceScaleFactor: number;
}

export interface TextMark {
  text: string;
  x: number;
  y: number;
}

export interface PageBox {
  width: number;
  height: number;
}

export interface ScaleBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ScaleRegion {
  scaleText: string;
  pageSpaceScaleFactor: number;
  /** Page-space rectangle this factor applies to. */
  bounds: ScaleBounds;
  /** True when this is the only printed scale and it covers the sheet. */
  coversPage: boolean;
  anchorX: number;
  anchorY: number;
  source: "stated_on_sheet" | "manual";
  verified: boolean;
}

const ARCH_SCALE = /(?:scale\s*[:.]?\s*)?(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(?:"|″|”|in(?:ch(?:es)?)?)\s*=\s*(\d+(?:\.\d+)?)\s*(?:'|′|’|\s*ft)?\s*(?:-\s*(\d+(?:\.\d+)?)\s*(?:"|″|”)?)?/gi;
const RATIO_SCALE = /(?:scale\s*[:.]?\s*)?(?<![0-9.])(\d+)\s*:\s*(\d+)(?!\s*(?:"|″|”|'))/gi;

function parsePaperInches(raw: string): number | null {
  const text = raw.replace(/\s+/g, "");
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    if (den === 0) return null;
    const value = Number(fraction[1]) / den;
    return value > 0 ? value : null;
  }
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseRealFeet(feetRaw: string, inchesRaw: string | undefined): number | null {
  const feet = Number(feetRaw);
  const inches = inchesRaw != null && inchesRaw !== "" ? Number(inchesRaw) : 0;
  if (!Number.isFinite(feet) || !Number.isFinite(inches) || inches >= 12 || inches < 0) return null;
  const total = feet + inches / 12;
  return total > 0 ? total : null;
}

/** Feet per PDF point for one printed declaration, or null when it is not a scale. */
export function feetPerPointFromPrintedScale(raw: string): PrintedScale | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  ARCH_SCALE.lastIndex = 0;
  const arch = ARCH_SCALE.exec(text);
  if (arch && arch.index != null) {
    const paperInches = parsePaperInches(arch[1]);
    const realFeet = parseRealFeet(arch[2], arch[3]);
    if (paperInches != null && realFeet != null) {
      const feetPerPaperInch = realFeet / paperInches;
      const matched = text.slice(arch.index, ARCH_SCALE.lastIndex).trim();
      return {
        scaleText: matched,
        pageSpaceScaleFactor: feetPerPaperInch / PDF_POINTS_PER_INCH,
      };
    }
  }

  RATIO_SCALE.lastIndex = 0;
  const ratio = RATIO_SCALE.exec(text);
  if (ratio) {
    const paper = Number(ratio[1]);
    const real = Number(ratio[2]);
    if (paper > 0 && real > 0) {
      // 1:100 means 1 paper inch represents 100 real inches.
      const feetPerPaperInch = (real / paper) / 12;
      const matched = text.slice(ratio.index, RATIO_SCALE.lastIndex).trim();
      return {
        scaleText: matched,
        pageSpaceScaleFactor: feetPerPaperInch / PDF_POINTS_PER_INCH,
      };
    }
  }
  return null;
}

interface LineGroup {
  text: string;
  x: number;
  y: number;
}

function linesFromMarks(marks: TextMark[]): LineGroup[] {
  const sorted = [...marks]
    .filter((mark) => mark.text.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Array<{ y: number; items: TextMark[] }> = [];
  for (const mark of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate.y - mark.y) <= 8);
    if (line) line.items.push(mark);
    else lines.push({ y: mark.y, items: [mark] });
  }
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const items = [...line.items].sort((a, b) => a.x - b.x);
    let current = "";
    let anchorX = items[0]?.x ?? 0;
    let lastX = items[0]?.x ?? 0;
    for (const item of items) {
      if (current && item.x - lastX > 80) {
        groups.push({ text: current.trim(), x: anchorX, y: line.y });
        current = "";
        anchorX = item.x;
      }
      current = `${current} ${item.text}`;
      lastX = item.x;
    }
    if (current.trim()) groups.push({ text: current.trim(), x: anchorX, y: line.y });
  }
  return groups;
}

/**
 * One region per printed scale. A single scale covers the page. Several scales
 * split the page along the wider gap between their titles so a plan scale and
 * a detail scale do not share a factor.
 */
export function scaleRegionsFromMarks(marks: TextMark[], page: PageBox): ScaleRegion[] {
  const found: Array<{ scale: PrintedScale; x: number; y: number }> = [];
  for (const line of linesFromMarks(marks)) {
    const scale = feetPerPointFromPrintedScale(line.text);
    if (!scale) continue;
    found.push({ scale, x: line.x, y: line.y });
  }
  if (found.length === 0 || page.width <= 0 || page.height <= 0) return [];
  if (found.length === 1) {
    const only = found[0];
    return [{
      scaleText: only.scale.scaleText,
      pageSpaceScaleFactor: only.scale.pageSpaceScaleFactor,
      bounds: { minX: 0, minY: 0, maxX: page.width, maxY: page.height },
      coversPage: true,
      anchorX: only.x,
      anchorY: only.y,
      source: "stated_on_sheet",
      verified: false,
    }];
  }

  const xSpread = Math.max(...found.map((item) => item.x)) - Math.min(...found.map((item) => item.x));
  const ySpread = Math.max(...found.map((item) => item.y)) - Math.min(...found.map((item) => item.y));
  const splitOnY = ySpread > xSpread;
  const sorted = [...found].sort((a, b) => (splitOnY ? a.y - b.y : a.x - b.x));
  const cuts = [0];
  for (let i = 0; i < sorted.length - 1; i++) {
    const mid = splitOnY ? (sorted[i].y + sorted[i + 1].y) / 2 : (sorted[i].x + sorted[i + 1].x) / 2;
    cuts.push(mid);
  }
  cuts.push(splitOnY ? page.height : page.width);

  return sorted.map((item, index) => ({
    scaleText: item.scale.scaleText,
    pageSpaceScaleFactor: item.scale.pageSpaceScaleFactor,
    bounds: splitOnY
      ? { minX: 0, minY: cuts[index], maxX: page.width, maxY: cuts[index + 1] }
      : { minX: cuts[index], minY: 0, maxX: cuts[index + 1], maxY: page.height },
    coversPage: false,
    anchorX: item.x,
    anchorY: item.y,
    source: "stated_on_sheet" as const,
    verified: false,
  }));
}

const BOUNDARY_PT = 1;

/** The printed scale whose bounds contain this page-space point. Boundary ties stay unscaled. */
export function regionForPoint(
  point: { x: number; y: number },
  regions: ScaleRegion[],
): ScaleRegion | null {
  if (regions.length === 0) return null;
  if (regions.length === 1 && regions[0].coversPage) return regions[0];
  const hits = regions.filter((region) => (
    point.x >= region.bounds.minX
    && point.x <= region.bounds.maxX
    && point.y >= region.bounds.minY
    && point.y <= region.bounds.maxY
  ));
  if (hits.length !== 1) return null;
  const region = hits[0];
  const onSharedEdge = regions.some((other) => {
    if (other === region) return false;
    const sharesX = Math.abs(point.x - region.bounds.minX) <= BOUNDARY_PT
      && Math.abs(other.bounds.maxX - region.bounds.minX) <= BOUNDARY_PT;
    const sharesY = Math.abs(point.y - region.bounds.minY) <= BOUNDARY_PT
      && Math.abs(other.bounds.maxY - region.bounds.minY) <= BOUNDARY_PT;
    return sharesX || sharesY;
  });
  if (onSharedEdge) return null;
  return region;
}

/**
 * A two-point calibration replaces the printed scale for the region that
 * contains the midpoint. Other regions on the sheet keep their own factors.
 */
export function applyManualScale(
  regions: ScaleRegion[],
  midpoint: { x: number; y: number },
  pageSpaceScaleFactor: number,
  scaleText: string,
  page: PageBox,
): ScaleRegion[] {
  const manual: ScaleRegion = {
    scaleText,
    pageSpaceScaleFactor,
    bounds: { minX: 0, minY: 0, maxX: page.width, maxY: page.height },
    coversPage: regions.length <= 1,
    anchorX: midpoint.x,
    anchorY: midpoint.y,
    source: "manual",
    verified: true,
  };
  if (regions.length === 0) return [manual];
  const target = regionForPoint(midpoint, regions) ?? (regions.length === 1 ? regions[0] : null);
  if (!target) {
    return [...regions, { ...manual, coversPage: false }];
  }
  return regions.map((region) => (
    region === target
      ? { ...manual, bounds: region.bounds, coversPage: region.coversPage }
      : region
  ));
}
