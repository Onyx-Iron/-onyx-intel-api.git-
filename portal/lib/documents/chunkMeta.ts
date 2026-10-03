/**
 * XD-02 chunk provenance shape stored in chunks.meta / document_chunks.meta.
 * page_number stays a real column; this bag carries parser + layout hints.
 */

export type ChunkParserId = "docling" | "gemini" | "pdfplumber";

export interface ChunkMeta {
  parser_id: ChunkParserId;
  confidence: number | null;
  heading_path: string[] | null;
  bbox: { page?: number; x0?: number; y0?: number; x1?: number; y1?: number } | null;
  source: "page-processor" | "portal-ingest";
  density_chars?: number;
}

export function formatChunkCitationLabel(opts: {
  pageNumber: number | null | undefined;
  meta?: Partial<ChunkMeta> | null;
}): string {
  const page = opts.pageNumber ?? "?";
  const heading = Array.isArray(opts.meta?.heading_path) && opts.meta!.heading_path!.length
    ? ` › ${opts.meta!.heading_path!.join(" › ")}`
    : "";
  const parser = opts.meta?.parser_id ? ` · ${opts.meta.parser_id}` : "";
  return `page ${page}${heading}${parser}`;
}
