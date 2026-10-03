/**
 * Read one PDF's embedded text and stroked paths, then measure them with the
 * scale printed on that page. No model call.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractVectorsFromPdfPage } from "@/lib/cad/pdf-vector-extract";
import { measurePageGeometry, type MeasuredGeometry, type PagePath } from "@/lib/takeoff/measure-geometry";
import { scaleRegionsFromMarks, type ScaleRegion, type TextMark } from "@/lib/takeoff/stated-scale";

type PdfJsModule = {
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<PdfJsPage>;
      destroy: () => Promise<void>;
    }>;
  };
};

let pdfjsModule: PdfJsModule | null = null;

function standardFontDataUrl(): string | undefined {
  try {
    const require = createRequire(fileURLToPath(import.meta.url));
    const pkg = require.resolve("pdfjs-dist/package.json");
    const dir = join(dirname(pkg), "standard_fonts");
    return `${pathToFileURL(dir).href}/`;
  } catch {
    return undefined;
  }
}

async function loadPdfjs(): Promise<PdfJsModule> {
  if (pdfjsModule) return pdfjsModule;
  pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs") as PdfJsModule;
  return pdfjsModule;
}

export interface MeasuredPdfPage {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  text: string;
  regions: ScaleRegion[];
  rows: MeasuredGeometry[];
}

interface PdfJsPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
  getOperatorList: () => Promise<unknown>;
}

function pathsFromVectors(vectors: Array<{ points: Array<[number, number]>; closed?: boolean }>): PagePath[] {
  return vectors.flatMap((vector) => {
    if (vector.points.length < 2) return [];
    const points = vector.points.map(([x, y]) => ({ x, y }));
    const first = points[0];
    const last = points[points.length - 1];
    const closed = vector.closed === true || (points.length >= 4 && Math.hypot(first.x - last.x, first.y - last.y) < 1);
    return [{ points: closed ? points.slice(0, -1) : points, closed }];
  });
}

export async function measurePdfPage(page: PdfJsPage, pageNumber: number): Promise<MeasuredPdfPage> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const marks: TextMark[] = [];
  const parts: string[] = [];
  for (const item of content.items) {
    const text = (item.str ?? "").trim();
    if (!text) continue;
    parts.push(text);
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    marks.push({ text, x: transform[4] ?? 0, y: transform[5] ?? 0 });
  }
  const regions = scaleRegionsFromMarks(marks, { width: viewport.width, height: viewport.height });
  const vectors = await extractVectorsFromPdfPage(page);
  const rows = measurePageGeometry(pathsFromVectors(vectors), regions);
  return {
    pageNumber,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    text: parts.join(" ").replace(/\s+/g, " ").trim(),
    regions,
    rows,
  };
}

export async function measurePdfBytes(bytes: Uint8Array): Promise<MeasuredPdfPage[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    standardFontDataUrl: standardFontDataUrl(),
  }).promise;
  const pages: MeasuredPdfPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      pages.push(await measurePdfPage(page, pageNumber));
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return pages;
}

type MeasurementDb = {
  from: (table: string) => {
    delete: () => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    insert: (rows: unknown) => Promise<{ error: { message: string } | null }>;
  };
};

/** Writes scale regions and page-space quantities. Replaces an earlier stated-scale pass on this file. */
export async function saveMeasuredPages(
  db: MeasurementDb,
  args: {
    tenantId: string;
    projectId: string | null;
    documentId: string;
    pages: Array<{ id: string; pageNumber: number; measured: MeasuredPdfPage }>;
  },
): Promise<number[]> {
  const unscaled: number[] = [];
  await db.from("takeoff_items").delete().eq("document_id", args.documentId).eq("tenant_id", args.tenantId).eq("source_method", "stated_scale");
  for (const page of args.pages) {
    const sheet = page.measured;
    await db.from("sheet_scale_regions").update({ active: false, updated_at: new Date().toISOString() })
      .eq("page_id", page.id).eq("tenant_id", args.tenantId).eq("active", true);
    if (sheet.regions.length === 0) unscaled.push(page.pageNumber);
    else {
      const inserted = await db.from("sheet_scale_regions").insert(sheet.regions.map((region) => ({
        tenant_id: args.tenantId,
        project_id: args.projectId,
        page_id: page.id,
        scale_text: region.scaleText,
        page_space_scale_factor: region.pageSpaceScaleFactor,
        min_x: region.bounds.minX,
        min_y: region.bounds.minY,
        max_x: region.bounds.maxX,
        max_y: region.bounds.maxY,
        covers_page: region.coversPage,
        anchor_x: region.anchorX,
        anchor_y: region.anchorY,
        source: region.source,
        verified: region.verified,
        status: "stated",
        active: true,
      })));
      if (inserted.error) throw new Error(inserted.error.message);
    }
    if (sheet.rows.length > 0 && args.projectId) {
      const payload = sheet.rows.map((row) => ({
        tenant_id: args.tenantId,
        project_id: args.projectId,
        document_id: args.documentId,
        sheet_id: page.id,
        page: page.pageNumber,
        label: row.kind === "area" ? "Closed area" : "Polyline",
        quantity: row.quantity,
        unit: row.unit,
        type: row.kind,
        coordinate_system: "page_space",
        origin_method: row.originMethod,
        origin_actor: "deterministic_parser",
        source_method: "stated_scale",
        review_status: row.quantity == null ? "suggested" : "approved",
        scale_unit: "ft",
        printed_scale: row.scaleText,
        points: row.points,
        geometry: { points: row.points, closed: row.closed, kind: row.kind },
        meta: {
          printed_scale: row.scaleText,
          page_space_scale_factor: row.pageSpaceScaleFactor,
          origin_method: row.originMethod,
        },
      }));
      for (let i = 0; i < payload.length; i += 200) {
        const inserted = await db.from("takeoff_items").insert(payload.slice(i, i + 200));
        if (inserted.error) throw new Error(inserted.error.message);
      }
    }
    const updated = await db.from("document_pages").update({
      status: "done",
      ocr_text: sheet.text || null,
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", page.id).eq("tenant_id", args.tenantId).eq("tenant_id", args.tenantId);
    if (updated.error) throw new Error(updated.error.message);
  }
  return unscaled;
}
