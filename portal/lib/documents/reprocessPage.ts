/**
 * Partial reprocess — reset one page (or all pages) for OCR and/or takeoff
 * and re-enqueue the matching Edge workers without a full split.
 */

import { after } from "next/server";
import { invokePageProcessor, invokePageTakeoffWorker } from "@/lib/documents/invokePageWorkers";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export type ReprocessStage = "ocr" | "takeoff" | "both";

export interface DocumentPageRow {
  id: string;
  page_number: number;
  storage_path: string;
  status: string | null;
  takeoff_status: string | null;
}

export function selectPagesForReprocess(
  pages: DocumentPageRow[],
  pageNumber?: number | null,
): DocumentPageRow[] {
  if (pageNumber == null) return pages;
  return pages.filter((p) => p.page_number === pageNumber);
}

export function stagesToRun(stage: ReprocessStage): Array<"ocr" | "takeoff"> {
  if (stage === "both") return ["ocr", "takeoff"];
  return [stage];
}

export async function reprocessDocumentPages(args: {
  db: AnyDb;
  tenantId: string;
  projectId: string;
  documentId: string;
  stage: ReprocessStage;
  pageNumber?: number | null;
  source?: string;
}): Promise<{ pages: number; stages: string[]; pageNumbers: number[] }> {
  const { db, tenantId, projectId, documentId, stage, pageNumber } = args;
  const source = args.source ?? "portal:reprocess";

  const { data: pageRows, error: pagesErr } = await db
    .from("document_pages")
    .select("id, page_number, storage_path, status, takeoff_status")
    .eq("document_id", documentId)
    .eq("tenant_id", tenantId)
    .order("page_number", { ascending: true });
  if (pagesErr) throw new Error(pagesErr.message);

  const allPages = (pageRows ?? []) as DocumentPageRow[];
  const selected = selectPagesForReprocess(allPages, pageNumber);
  if (selected.length === 0) {
    throw new Error(
      pageNumber != null
        ? `Page ${pageNumber} not found — split the document first`
        : "No split pages found — run full Retry / page-split first",
    );
  }

  const missingStorage = selected.filter((p) => !p.storage_path);
  if (missingStorage.length > 0) {
    throw new Error(`Page(s) missing storage_path: ${missingStorage.map((p) => p.page_number).join(", ")}`);
  }

  const stages = stagesToRun(stage);
  const now = new Date().toISOString();
  const ids = selected.map((p) => p.id);

  if (stages.includes("ocr")) {
    const { error } = await db.from("document_pages").update({
      status: "pending",
      error: null,
      updated_at: now,
    }).in("id", ids).eq("tenant_id", tenantId);
    if (error) throw new Error(`reset OCR status: ${error.message}`);
  }
  if (stages.includes("takeoff")) {
    const { error } = await db.from("document_pages").update({
      takeoff_status: "pending",
      takeoff_error: null,
      updated_at: now,
    }).in("id", ids).eq("tenant_id", tenantId);
    if (error) throw new Error(`reset takeoff status: ${error.message}`);
  }

  // Pull parent out of a terminal Partial/Failed so list polling + finalize resume.
  const parentPatch: Record<string, unknown> = {
    status: "split",
    split_status: "done",
    last_error: null,
    last_error_step: null,
    processing_started_at: now,
  };
  if (stages.includes("ocr")) parentPatch.ocr_status = "processing";
  if (stages.includes("takeoff")) parentPatch.takeoff_status = "processing";
  await db.from("documents").update(parentPatch).eq("id", documentId).eq("tenant_id", tenantId);

  await logDocumentProcessingEvent({
    tenantId,
    projectId,
    documentId,
    step: stages.includes("ocr") ? "ocr" : "takeoff",
    status: "started",
    worker: source,
    errorMessage: `reprocess ${stages.join("+")} pages=${selected.map((p) => p.page_number).join(",")}`,
  });

  after(async () => {
    for (const page of selected) {
      const payload = {
        page_id: page.id,
        document_id: documentId,
        tenant_id: tenantId,
        project_id: projectId,
        page_number: page.page_number,
        storage_path: page.storage_path,
      };
      try {
        if (stages.includes("ocr")) await invokePageProcessor(payload);
        if (stages.includes("takeoff")) await invokePageTakeoffWorker(payload);
      } catch (err) {
        console.error("[reprocessDocumentPages] invoke failed", page.page_number, err);
        const detail = err instanceof Error ? err.message : String(err);
        if (stages.includes("ocr")) {
          await db.from("document_pages").update({
            status: "error",
            error: detail.slice(0, 1000),
            updated_at: new Date().toISOString(),
          }).eq("id", page.id).eq("tenant_id", tenantId);
        }
        if (stages.includes("takeoff")) {
          await db.from("document_pages").update({
            takeoff_status: "error",
            takeoff_error: detail.slice(0, 1000),
            updated_at: new Date().toISOString(),
          }).eq("id", page.id).eq("tenant_id", tenantId);
        }
        await logDocumentProcessingEvent({
          tenantId,
          projectId,
          documentId,
          documentPageId: page.id,
          step: stages.includes("ocr") ? "ocr" : "takeoff",
          status: "failed",
          worker: source,
          errorMessage: detail,
        });
      }
    }
  });

  return {
    pages: selected.length,
    stages,
    pageNumbers: selected.map((p) => p.page_number),
  };
}
