import type { TablesUpdate } from "@/lib/supabase/types";

export interface RetryableDocumentSource {
  drive_file_id: string | null;
  meta: Record<string, unknown> | null;
}

export function canRetryDocument(source: RetryableDocumentSource): boolean {
  const meta = source.meta ?? {};
  return Boolean(
    source.drive_file_id
    || (typeof meta.drive_file_id === "string" && meta.drive_file_id.length > 0)
    || (typeof meta.storage_path === "string" && meta.storage_path.length > 0)
  );
}

export function buildRetryDocumentUpdate(nowIso: string): TablesUpdate<"documents"> {
  return {
    status: "processing",
    last_error: null,
    last_error_step: null,
    processing_started_at: nowIso,
    processing_completed_at: null,
  };
}
