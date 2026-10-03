import { PAGE_SPLIT_BYTES } from "@/lib/documents/upload-plan";
import { FUNCTION_BODY_LIMIT_BYTES } from "@/lib/vercel/function-limits";

/**
 * Signed upload to plans-bucket is the path for plan sets and for anything
 * that cannot fit in a function body. Medium CAD, IFC, and spreadsheet files
 * post straight to /api/takeoff/extract. PDFs at the page-split threshold
 * stay on signed upload so the async splitter owns them.
 */
export function shouldUseSignedTakeoffUpload(file: { name: string; size: number }): boolean {
  if (file.size > FUNCTION_BODY_LIMIT_BYTES) return true;
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  return isPdf && file.size >= PAGE_SPLIT_BYTES;
}
