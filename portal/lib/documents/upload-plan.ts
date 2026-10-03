export const PLANS_BUCKET = "plans-bucket";
export const LEGACY_DOCUMENT_BUCKET = "project-documents";
export const PAGE_SPLIT_BYTES = 3.5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Where a document should be processed. PDFs go to the page-split worker. */
export type IngestRoute = "split-drive" | "split-storage" | "inline" | "reupload";

const STORAGE_BUCKETS = new Set([PLANS_BUCKET, LEGACY_DOCUMENT_BUCKET]);

/** Buckets to try when reading a stored upload. New files use plans-bucket; older uploads used project-documents. */
export function documentStorageBuckets(meta: Record<string, unknown>): string[] {
  const named = typeof meta.storage === "string" && STORAGE_BUCKETS.has(meta.storage) ? [meta.storage] : [];
  return [...new Set([...named, PLANS_BUCKET, LEGACY_DOCUMENT_BUCKET])];
}

export function originalStoragePath(documentId: string, fileName: string): string {
  const ext = fileName.match(/(\.[A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase() ?? "";
  if (ext === ".pdf" || ext === "") return `originals/${documentId}.pdf`;
  return `originals/${documentId}${ext}`;
}

export function mimeTypeForFile(fileName: string, contentType?: string | null): string {
  if (contentType && contentType !== "application/octet-stream") return contentType;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "tif":
    case "tiff": return "image/tiff";
    case "dwg": return "image/vnd.dwg";
    case "dxf": return "application/dxf";
    default: return "application/octet-stream";
  }
}

export function fileLivesInPlansBucket(storage: string | null, storagePath: string | null): boolean {
  if (!storagePath) return false;
  return storage === PLANS_BUCKET || storagePath.startsWith("originals/");
}

/**
 * PDFs are split in the background worker, which already owns per-page OCR,
 * embeddings, and takeoff. Vercel only keeps the short path for images and
 * for a small legacy object that never made it into plans-bucket.
 */
export function chooseIngestRoute(input: {
  fileName: string;
  sizeBytes: number | null;
  driveFileId?: string | null;
  storagePath?: string | null;
  storage?: string | null;
}): IngestRoute {
  if (!input.fileName.toLowerCase().endsWith(".pdf")) return "inline";
  if (input.driveFileId) return "split-drive";
  if (fileLivesInPlansBucket(input.storage ?? null, input.storagePath ?? null)) return "split-storage";
  if (
    input.storagePath
    && input.sizeBytes != null
    && Number.isFinite(input.sizeBytes)
    && input.sizeBytes < PAGE_SPLIT_BYTES
  ) {
    return "inline";
  }
  return "reupload";
}
