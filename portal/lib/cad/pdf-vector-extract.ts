/**
 * PDF → vector extraction, client-side.
 *
 * Walks a pdfjs page's operator list and pulls out stroked polylines +
 * nearby text labels, so we can feed civil site plans that came in as PDF
 * (not DXF/DWG) into the same CAD Vector Layer classifier + hover-approve
 * flow used for real CAD.
 *
 * Strategy:
 *   1. Iterate operator list.
 *   2. Track transform stack (CTM), current stroke color, and buffered path.
 *   3. Whenever a stroke op fires, emit a polyline in PAGE-UNIT coordinates
 *      colored by the RGB currently in play.
 *   4. Simultaneously capture text with its transform-derived position.
 *   5. After the pass, attach each polyline to its nearest text token
 *      within a small radius (proxy for the "layer name" a CAD parser
 *      would have given us).
 *
 * The resulting synthetic layer name follows the shape
 *   "PDF-<HEX_COLOR>" or "PDF-<TEXT-TAG-UPPERCASED>"
 * which the existing `layer-classify.ts` catches via its keyword rules.
 */

// deno-lint-ignore-file no-explicit-any

export interface ExtractedVector {
  layer: string;                       // synthetic (color + optional text) — feeds classifier
  type: "polyline" | "point";
  points: Array<[number, number]>;     // page-user-unit coordinates (already in pdf.js space)
  text_tag?: string;
  color?: string;                      // #RRGGBB
}

interface Segment {
  cmd: "M" | "L" | "C" | "V" | "Y";
  args: number[];
}

/** pdf.js RGB channels are 0–1. Multiplying by 255 here keeps civil colors distinct. */
export function pdfChannelHex(r: number, g: number, b: number): string {
  return rgb(r, g, b);
}

/** Short chords along a cubic so the measured length is longer than the endpoint chord when the curve bows. */
export function flattenCubic(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  steps = 8,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const count = Math.max(2, steps);
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const mt = 1 - t;
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
    out.push([x, y]);
  }
  return out;
}

export function polylineLength(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeCommandStream(ops: any, argsArr: number[]): Segment[] {
  // Encoded like: [op0, op1, op2, ...] with argsArr flattened per pdfjs docs.
  // We only care about moveTo (M), lineTo (L), curveTo (C), quadratic (Q), and close (Z).
  // pdfjs `OPS.constructPath` args = [ [ops], [args] ]
  const segs: Segment[] = [];
  let idx = 0;
  for (const op of ops) {
    // See pdfjs OPS: moveTo=13, lineTo=14, curveTo=15, curveTo2=16, curveTo3=17, closePath=18, rectangle=19
    if (op === 13)      { segs.push({ cmd: "M", args: argsArr.slice(idx, idx + 2) }); idx += 2; }
    else if (op === 14) { segs.push({ cmd: "L", args: argsArr.slice(idx, idx + 2) }); idx += 2; }
    else if (op === 15) { segs.push({ cmd: "C", args: argsArr.slice(idx, idx + 6) }); idx += 6; }
    else if (op === 16) { segs.push({ cmd: "V", args: argsArr.slice(idx, idx + 4) }); idx += 4; }
    else if (op === 17) { segs.push({ cmd: "Y", args: argsArr.slice(idx, idx + 4) }); idx += 4; }
    else if (op === 18) { /* closePath */ }
    else if (op === 19) {
      const [x, y, w, h] = argsArr.slice(idx, idx + 4); idx += 4;
      segs.push({ cmd: "M", args: [x, y] });
      segs.push({ cmd: "L", args: [x + w, y] });
      segs.push({ cmd: "L", args: [x + w, y + h] });
      segs.push({ cmd: "L", args: [x, y + h] });
      segs.push({ cmd: "L", args: [x, y] });
    }
  }
  return segs;
}

function applyTransform(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function multiply(a: number[], b: number[]): number[] {
  return [
    a[0]*b[0] + a[2]*b[1],
    a[1]*b[0] + a[3]*b[1],
    a[0]*b[2] + a[2]*b[3],
    a[1]*b[2] + a[3]*b[3],
    a[0]*b[4] + a[2]*b[5] + a[4],
    a[1]*b[4] + a[3]*b[5] + a[5],
  ];
}

const rgb = (r: number, g: number, b: number) => {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
};

// Guess a layer-ish tag from a color when we don't have text nearby.
function colorHint(hex: string): string {
  const map: Array<[RegExp, string]> = [
    [/^#(0[89A-F]|10)[0-9A-F]{4}$/i, "C-STRM"],   // deep blue
    [/^#[0-3][0-3][0-4A-F][0-9A-F]{3}$/i, "C-SSWR"], // dark violet
    [/^#[0-1][A-F][A-F][0-9A-F]{3}$/i, "L-TURF"],  // bright green
    [/^#(4|5|6)[0-9A-F]{5}$/i, "C-PAVE"],          // greyish
    [/^#[E-F][0-9A-F]{5}$/i, "C-PROP"],            // red-ish
  ];
  for (const [re, layer] of map) if (re.test(hex)) return layer;
  return `PDF-${hex.replace("#", "").toUpperCase()}`;
}

interface TextToken { text: string; x: number; y: number }

function nearestText(cx: number, cy: number, tokens: TextToken[], maxDist: number): TextToken | null {
  let best: TextToken | null = null;
  let bestD = maxDist;
  for (const t of tokens) {
    const d = Math.hypot(t.x - cx, t.y - cy);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

/**
 * Extract polylines + labels from a pdfjs page proxy.
 * Returns page-unit coordinates (typically points, 72/inch).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function extractVectorsFromPdfPage(page: any): Promise<ExtractedVector[]> {
  const ops = await page.getOperatorList();
  const textContent = await page.getTextContent();
  const tokens: TextToken[] = [];
  for (const item of (textContent.items ?? []) as Array<{ str: string; transform?: number[] }>) {
    const s = (item.str ?? "").trim();
    if (!s) continue;
    const tm = item.transform ?? [1, 0, 0, 1, 0, 0];
    tokens.push({ text: s, x: tm[4], y: tm[5] });
  }

  // Transform stack starts identity.
  const ctmStack: number[][] = [[1, 0, 0, 1, 0, 0]];
  let color = "#000000";
  let path: Segment[] = [];

  const emitted: ExtractedVector[] = [];

  // pdfjs.OPS numeric constants (from pdfjs-dist/src/shared/util.js).
  // We reference by number to avoid tight coupling.
  const OP = {
    save: 10, restore: 11, transform: 12,
    setStrokeRGBColor: 45, setFillRGBColor: 46, setStrokeColor: 43, setFillColor: 44,
    setStrokeGray: 39, setFillGray: 40, setStrokeCMYKColor: 41, setFillCMYKColor: 42,
    constructPath: 91, stroke: 20, fillStroke: 22, endPath: 27,
  } as const;

  const fnArray: number[] = ops.fnArray;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const argsArray: any[] = ops.argsArray;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === OP.save) ctmStack.push([...ctmStack[ctmStack.length - 1]]);
    else if (fn === OP.restore) { if (ctmStack.length > 1) ctmStack.pop(); }
    else if (fn === OP.transform) {
      // args = [a, b, c, d, e, f]
      const cur = ctmStack[ctmStack.length - 1];
      const next = multiply(cur, args);
      ctmStack[ctmStack.length - 1] = next;
    }
    else if (fn === OP.setStrokeRGBColor) color = pdfChannelHex(args[0], args[1], args[2]);
    else if (fn === OP.setFillRGBColor)   color = pdfChannelHex(args[0], args[1], args[2]);
    else if (fn === OP.setStrokeGray)     { const g = args[0]; color = rgb(g, g, g); }
    else if (fn === OP.constructPath) {
      const [opsInner, argsInner] = args;
      path = decodeCommandStream(opsInner, argsInner);
    }
    else if (fn === OP.stroke || fn === OP.fillStroke) {
      // Emit the current path as a transformed polyline.
      if (path.length >= 2) {
        const ctm = ctmStack[ctmStack.length - 1];
        const pts: Array<[number, number]> = [];
        let last: [number, number] | null = null;
        let cursor: [number, number] | null = null;
        for (const seg of path) {
          if (seg.cmd === "M" || seg.cmd === "L") {
            cursor = [seg.args[0], seg.args[1]];
            const [wx, wy] = applyTransform(ctm, seg.args[0], seg.args[1]);
            if (!last || Math.hypot(wx - last[0], wy - last[1]) > 0.05) {
              pts.push([wx, wy]);
              last = [wx, wy];
            }
          } else if ((seg.cmd === "C" || seg.cmd === "V" || seg.cmd === "Y") && cursor) {
            let c1: [number, number];
            let c2: [number, number];
            let end: [number, number];
            if (seg.cmd === "C") {
              c1 = [seg.args[0], seg.args[1]];
              c2 = [seg.args[2], seg.args[3]];
              end = [seg.args[4], seg.args[5]];
            } else if (seg.cmd === "V") {
              c1 = cursor;
              c2 = [seg.args[0], seg.args[1]];
              end = [seg.args[2], seg.args[3]];
            } else {
              c1 = [seg.args[0], seg.args[1]];
              end = [seg.args[2], seg.args[3]];
              c2 = end;
            }
            for (const [x, y] of flattenCubic(cursor, c1, c2, end)) {
              const [wx, wy] = applyTransform(ctm, x, y);
              if (!last || Math.hypot(wx - last[0], wy - last[1]) > 0.05) {
                pts.push([wx, wy]);
                last = [wx, wy];
              }
            }
            cursor = end;
          }
        }
        if (pts.length >= 2) {
          // Centroid for text-association
          let cx = 0, cy = 0;
          for (const p of pts) { cx += p[0]; cy += p[1]; }
          cx /= pts.length; cy /= pts.length;

          const tag = nearestText(cx, cy, tokens, 50); // 50 pt search radius
          const layer = tag ? `PDF-${tag.text.toUpperCase().replace(/[^\w-]/g, "-")}` : colorHint(color);

          emitted.push({
            layer,
            type: "polyline",
            points: pts,
            color,
            text_tag: tag?.text,
          });
        }
      }
      path = [];
    }
    else if (fn === OP.endPath) path = [];
  }

  // Deduplicate near-duplicates that PDFs often emit twice (border + fill etc).
  const seen = new Set<string>();
  const uniq: ExtractedVector[] = [];
  for (const v of emitted) {
    const key = `${v.layer}|${v.points.length}|${v.points[0][0].toFixed(1)}|${v.points[0][1].toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(v);
  }

  // Prune tiny scribbles (< 2 pt) that are usually text glyph outlines, not real linework.
  return uniq.filter((v) => {
    if (v.points.length < 2) return false;
    let span = 0;
    for (let i = 1; i < v.points.length; i++) span += Math.hypot(v.points[i][0] - v.points[i-1][0], v.points[i][1] - v.points[i-1][1]);
    return span > 2;
  });
}
