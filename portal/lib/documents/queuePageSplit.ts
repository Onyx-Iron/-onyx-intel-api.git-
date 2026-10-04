/**
 * Shared "queue a document for async page-split" helper used by Documents
 * upload, import-drive, and ingest fallback. Keeps Drive / local originals
 * on the same page-split-worker contract so clients never have to know
 * which entry point created the row.
 */

import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import { invokePageSplitWorker } from "@/lib/documents/pageSplitWorker";
import { splitOversizedPdfOnPython } from "@/lib/documents/python-page-split";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { auditInsert } from "@/lib/audit";
import type { TablesInsert } from "@/lib/supabase/types";

export const PLANS_BUCKET = "plans-bucket";
/** Above this size, synchronous ingest is unreliable — always async-split PDFs. */
export const ASYNC_SPLIT_BYTES = 3.5 * 1024 * 1024;

/** pdf-lib on the edge isolate keeps the whole PDF. Larger files split on the Python service. */
export const EDGE_PDF_SPLIT_MAX_BYTES = 80 * 1024 * 1024;

export function isPdfFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf");
}

export function shouldAsyncSplitPdf(fileName: string, sizeBytes: number | null | undefined): boolean {
  if (!isPdfFileName(fileName)) return false;
  // Missing size: treat as large — safer than silent mid-stream death on sync path.
  if (sizeBytes == null || !Number.isFinite(sizeBytes)) return true;
  return sizeBytes >= ASYNC_SPLIT_BYTES;
}

interface QueueDriveArgs {
  tenantId: string;
  userId: string;
  projectId: string;
  driveFileId: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  /** When true, re-kick page-split if an existing stuck/error/queued row is found. */
  rekickIfStuck?: boolean;
}

export type QueueResult =
  | { ok: true; documentId: string; status: string; deduped: boolean; queued: boolean }
  | { ok: false; error: string; status: number; code?: string };

/**
 * Insert (or reuse) a Drive-backed documents row and kick page-split-worker.
 * Idempotent on (tenant, project, drive_file_id).
 */
export async function queueDriveDocumentForPageSplit(args: QueueDriveArgs): Promise<QueueResult> {
  const {
    tenantId, userId, projectId, driveFileId, fileName,
    mimeType, sizeBytes, rekickIfStuck = true,
  } = args;

  const accessToken = await getAccessToken(tenantId, userId);
  if (!accessToken) {
    return {
      ok: false,
      error: "Google Drive is not connected. Connect Google, then retry.",
      status: 412,
      code: "NEED_GOOGLE",
    };
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: existing } = await anyDb
    .from("documents")
    .select("id, status, page_count, meta")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("drive_file_id", driveFileId)
    .maybeSingle();

  if (existing?.id) {
    // Healthy terminals — skip re-split on casual re-import. Partial /
    // failed / in-flight states are always re-kickable on Retry.
    const skipRekick = ["complete", "ready", "done"].includes(String(existing.status));
    const needsRekick = !skipRekick && [
      "error", "failed", "queued", "pending", "processing", "split",
      "complete_with_errors",
    ].includes(String(existing.status));
    if (rekickIfStuck && needsRekick) {
      await kickPageSplit({
        db: anyDb,
        documentId: existing.id,
        tenantId,
        projectId,
        userId,
        accessToken,
        driveFileId,
        originalPath: `originals/${existing.id}.pdf`,
        source: "portal:queue-drive-rekick",
        sizeBytes: sizeBytes ?? existingSize(existing),
      });
      return { ok: true, documentId: existing.id, status: "queued", deduped: true, queued: true };
    }
    return {
      ok: true,
      documentId: existing.id,
      status: String(existing.status ?? "processing"),
      deduped: true,
      queued: false,
    };
  }

  const documentId = crypto.randomUUID();
  const originalPath = `originals/${documentId}.pdf`;
  const insertRow: TablesInsert<"documents"> = {
    id: documentId,
    tenant_id: tenantId,
    project_id: projectId,
    file_name: fileName,
    status: "queued",
    drive_file_id: driveFileId,
    uploaded_at: new Date().toISOString(),
    meta: buildDocumentRevisionMeta(fileName, {
      source: "google_drive",
      drive_file_id: driveFileId,
      size: sizeBytes ?? null,
      storage: PLANS_BUCKET,
      storage_path: originalPath,
      content_type: mimeType ?? "application/pdf",
    }),
  };

  const { error: insertErr } = await db.from("documents").insert(insertRow);
  if (insertErr) {
    // Concurrent double-submit can race the unique (tenant, project, drive_file_id)
    // index — recover by re-selecting and optionally rekicking.
    const { data: raced } = await anyDb
      .from("documents")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("drive_file_id", driveFileId)
      .maybeSingle();
    if (raced?.id) {
      const skipRekick = ["complete", "ready", "done"].includes(String(raced.status));
      if (rekickIfStuck && !skipRekick) {
        await kickPageSplit({
          db: anyDb,
          documentId: raced.id,
          tenantId,
          projectId,
          userId,
          accessToken,
          driveFileId,
          originalPath: `originals/${raced.id}.pdf`,
          source: "portal:queue-drive-race-rekick",
          sizeBytes,
        });
        return { ok: true, documentId: raced.id, status: "queued", deduped: true, queued: true };
      }
      return {
        ok: true,
        documentId: raced.id,
        status: String(raced.status ?? "processing"),
        deduped: true,
        queued: false,
      };
    }
    return { ok: false, error: `[insert] ${insertErr.message}`, status: 500 };
  }

  auditInsert({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "documents",
    record_id: documentId,
    new_values: insertRow as unknown as Record<string, unknown>,
  });

  await kickPageSplit({
    db: anyDb,
    documentId,
    tenantId,
    projectId,
    userId,
    accessToken,
    driveFileId,
    originalPath,
    source: "portal:queue-drive",
    sizeBytes,
  });

  return { ok: true, documentId, status: "queued", deduped: false, queued: true };
}

interface QueueLocalArgs {
  tenantId: string;
  userId: string;
  projectId: string;
  documentId: string;
  originalPath: string;
  sizeBytes?: number | null;
}

/** Kick page-split for a PDF already in plans-bucket (local/multipart upload). */
export async function queueLocalDocumentForPageSplit(args: QueueLocalArgs): Promise<void> {
  const { tenantId, userId, projectId, documentId, originalPath, sizeBytes } = args;
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  await anyDb.from("documents").update({
    status: "queued",
    split_status: "pending",
    ocr_status: "pending",
    vector_status: "pending",
    takeoff_status: "pending",
    processing_started_at: new Date().toISOString(),
    last_error: null,
    last_error_step: null,
  }).eq("id", documentId).eq("tenant_id", tenantId);

  // after() keeps the serverless invoke alive after the 202 response —
  // bare `void fetch` can be frozen before the Edge Function is contacted.
  after(async () => {
    try {
      const oversized = await pdfExceedsEdgeSplit(anyDb, documentId, tenantId, sizeBytes);
      if (oversized) {
        await splitOversizedPdfOnPython({
          tenantId,
          projectId,
          documentId,
          userId,
          originalPath,
        });
      } else {
        await invokePageSplitWorker({
          document_id: documentId,
          tenant_id: tenantId,
          project_id: projectId,
          original_path: originalPath,
          is_local_upload: true,
          user_id: userId,
        });
      }
      await logDocumentProcessingEvent({
        tenantId,
        projectId,
        documentId,
        step: "split",
        status: "started",
        worker: "portal:queue-local",
      });
    } catch (err) {
      console.error("[queueLocalDocumentForPageSplit] invoke failed", err);
      const detail = err instanceof Error ? err.message : String(err);
      // Don't clobber status if the worker already advanced the row.
      await anyDb.from("documents").update({
        status: "error",
        last_error: detail.slice(0, 1000),
        last_error_step: "page_split_worker_invoke",
      }).eq("id", documentId).eq("tenant_id", tenantId).in("status", ["queued", "pending"]);
    }
  });
}

async function kickPageSplit(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  documentId: string;
  tenantId: string;
  projectId: string;
  userId: string;
  accessToken: string;
  driveFileId: string;
  originalPath: string;
  source: string;
  sizeBytes?: number | null;
}): Promise<void> {
  const { db, documentId, tenantId, projectId, userId, accessToken, driveFileId, originalPath, source, sizeBytes } = args;

  await db.from("documents").update({
    status: "queued",
    split_status: "pending",
    ocr_status: "pending",
    vector_status: "pending",
    takeoff_status: "pending",
    processing_started_at: new Date().toISOString(),
    last_error: null,
    last_error_step: null,
  }).eq("id", documentId).eq("tenant_id", tenantId);

  after(async () => {
    try {
      const oversized = await pdfExceedsEdgeSplit(db, documentId, tenantId, sizeBytes);
      if (oversized) {
        await splitOversizedPdfOnPython({
          tenantId,
          projectId,
          documentId,
          userId,
          originalPath,
          sourceUrl: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
          downloadAuthorization: `Bearer ${accessToken}`,
          uploadOriginalPath: originalPath,
        });
      } else {
        await invokePageSplitWorker({
          document_id: documentId,
          tenant_id: tenantId,
          project_id: projectId,
          drive_file_id: driveFileId,
          original_path: originalPath,
          access_token: accessToken,
          user_id: userId,
        });
      }
      await logDocumentProcessingEvent({
        tenantId,
        projectId,
        documentId,
        step: "split",
        status: "started",
        worker: source,
      });
    } catch (err) {
      console.error(`[${source}] page-split invoke failed`, err);
      const detail = err instanceof Error ? err.message : String(err);
      await db.from("documents").update({
        status: "error",
        last_error: detail.slice(0, 1000),
        last_error_step: "page_split_worker_invoke",
      }).eq("id", documentId).eq("tenant_id", tenantId).in("status", ["queued", "pending"]);
      await logDocumentProcessingEvent({
        tenantId,
        projectId,
        documentId,
        step: "split",
        status: "failed",
        worker: source,
        errorCode: "worker_invoke_failed",
        errorMessage: detail,
      });
    }
  });
}

function existingSize(row: { meta?: unknown; file_size?: number | null }): number | null {
  if (typeof row.file_size === "number" && row.file_size > 0) return row.file_size;
  return sizeFromMeta(row.meta);
}

function sizeFromMeta(meta: unknown): number | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const size = (meta as { size?: unknown }).size;
  return typeof size === "number" && size > 0 ? size : null;
}

async function pdfExceedsEdgeSplit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  documentId: string,
  tenantId: string,
  hinted?: number | null,
): Promise<boolean> {
  if (typeof hinted === "number" && hinted > EDGE_PDF_SPLIT_MAX_BYTES) return true;
  const { data } = await db.from("documents").select("file_size, meta").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  const size = existingSize((data ?? {}) as { meta?: unknown; file_size?: number | null });
  return typeof size === "number" && size > EDGE_PDF_SPLIT_MAX_BYTES;
}
