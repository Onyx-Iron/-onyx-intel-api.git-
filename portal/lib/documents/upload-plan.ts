export const PLANS_BUCKET = "plans-bucket";
export const LEGACY_DOCUMENT_BUCKET = "project-documents";
export const PAGE_SPLIT_BYTES = 3.5 * 1024 * 1024;

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

/**
 * Large PDFs must go to the page-split worker. Downloading them inside the
 * Vercel ingest request hits the body and time limits, then used to return 409
 * after the upload had already succeeded.
 */
export function shouldQueuePageSplit(input: {
  fileName: string;
  sizeBytes: number | null;
  hasSource: boolean;
}): boolean {
  if (!input.hasSource) return false;
  if (!input.fileName.toLowerCase().endsWith(".pdf")) return false;
  if (input.sizeBytes == null || !Number.isFinite(input.sizeBytes)) return false;
  return input.sizeBytes >= PAGE_SPLIT_BYTES;
}
