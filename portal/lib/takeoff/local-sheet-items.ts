/**
 * Takeoff candidates already on the page: grouped vectors and schedule rows.
 * Length and area stay at quantity 0 until the scale is confirmed on the canvas.
 */
import { classifyLayer } from "@/lib/cad/layer-classify";
import { extractVectorsFromPdfPage, type ExtractedVector } from "@/lib/cad/pdf-vector-extract";

export interface LocalSheetItem {
  description: string;
  quantity: number;
  unit: string;
  cost_code?: string;
  layer_hint?: string;
  source: "schedule" | "note" | "callout" | "image" | "text";
  confidence: number;
  raw_text?: string;
}

export interface ScheduleRow {
  label: string | null;
  quantity: number | null;
  unit: string | null;
  csi_code: string | null;
}

export function itemsFromPageGeometry(vectors: ExtractedVector[], pageText: string): { items: LocalSheetItem[]; page_summary: string } {
  const text = pageText.replace(/\s+/g, " ").trim();
  if (vectors.length === 0 && !text) return { items: [], page_summary: "" };

  const groups = new Map<string, ExtractedVector[]>();
  for (const vector of vectors) {
    const key = vector.layer || "PDF";
    const list = groups.get(key) ?? [];
    list.push(vector);
    groups.set(key, list);
  }

  const items: LocalSheetItem[] = [];
  for (const [layer, group] of groups) {
    const classified = classifyLayer(layer);
    const counted = classified.takeoff_type === "count";
    items.push({
      description: classified.description,
      quantity: counted ? group.length : 0,
      unit: classified.unit,
      cost_code: classified.cost_code,
      layer_hint: layer,
      source: counted ? "schedule" : "text",
      confidence: classified.confidence,
      raw_text: text.slice(0, 400) || undefined,
    });
  }
  return { page_summary: text.slice(0, 400), items };
}

export function itemsFromScheduleRows(rows: ScheduleRow[]): LocalSheetItem[] {
  return rows.flatMap((row) => {
    const description = (row.label ?? "").trim();
    if (!description) return [];
    const quantity = typeof row.quantity === "number" && Number.isFinite(row.quantity) ? row.quantity : 0;
    const code = row.csi_code && /^\d{2}-\d{2}-\d{2}$/.test(row.csi_code) ? row.csi_code : undefined;
    return [{
      description: description.slice(0, 400),
      quantity,
      unit: (row.unit ?? "EA").toUpperCase().slice(0, 12),
      cost_code: code,
      source: "schedule" as const,
      confidence: 1,
    }];
  });
}

export async function loadPageGeometry(bytes: Uint8Array): Promise<{ vectors: ExtractedVector[]; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as {
    getDocument: (src: Record<string, unknown>) => {
      promise: Promise<{
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
        destroy: () => Promise<void>;
      }>;
    };
  };
  const doc = await pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const vectors = await extractVectorsFromPdfPage(page);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str ?? "").join(" ").replace(/\s+/g, " ").trim();
    return { vectors, text };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
