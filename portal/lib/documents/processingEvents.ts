import { createServiceClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/types";

type Step = "split" | "ocr" | "vector" | "sheet_detection" | "takeoff" | "embedding" | "indexing";
type Status = "started" | "succeeded" | "failed" | "skipped";

export interface DocumentProcessingEventInput {
  tenantId: string;
  projectId?: string | null;
  documentId: string;
  documentPageId?: string | null;
  step: Step;
  status: Status;
  worker?: string | null;
  attemptNumber?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function logDocumentProcessingEvent(input: DocumentProcessingEventInput): Promise<void> {
  try {
    const db = await createServiceClient();
    const row: TablesInsert<"document_processing_events"> = {
      tenant_id: input.tenantId,
      project_id: input.projectId ?? null,
      document_id: input.documentId,
      document_page_id: input.documentPageId ?? null,
      step: input.step,
      status: input.status,
      worker: input.worker ?? null,
      attempt_number: input.attemptNumber ?? 1,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage?.slice(0, 2000) ?? null,
      completed_at: input.status === "started" ? null : new Date().toISOString(),
    };
    await db.from("document_processing_events").insert(row);
  } catch {
    // Best-effort observability only.
  }
}
