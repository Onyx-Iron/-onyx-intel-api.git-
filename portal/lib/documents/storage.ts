export const PLANS_BUCKET = "plans-bucket";
export const PROJECT_DOCUMENTS_BUCKET = "project-documents";

/**
 * Resolve the Supabase Storage bucket for a document's `meta.storage_path`.
 * Mirrors ingest routing: local multipart uploads use project-documents;
 * Drive-backed plans use plans-bucket.
 */
export function resolveDocumentStorageBucket(
  meta: Record<string, unknown> | null | undefined,
): string {
  const m = meta ?? {};
  if (m.storage === "supabase") return PROJECT_DOCUMENTS_BUCKET;
  if (typeof m.storage === "string" && m.storage !== "drive") return m.storage;
  return PLANS_BUCKET;
}
