/**
 * Shared "queue a document for async page-split" helper used by Documents
 * upload, import-drive, and ingest fallback. Keeps Drive / local originals
 * on the same page-split-worker contract so clients never have to know
 * which entry point created the row.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import { invokePageSplitWorker } from "@/lib/documents/pageSplitWorker";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { auditInsert } from "@/lib/audit";
import type { TablesInsert } from "@/lib/supabase/types";

export const PLANS_BUCKET = "plans-bucket";
/** Above this size, sync Gemini ingest is unreliable on Vercel — always async-split PDFs. */
export const ASYNC_SPLIT_BYTES = 3.5 * 1024 * 1024;

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
    // Terminal success — don't re-split a healthy doc on re-import.
    const terminalOk = ["complete", "ready", "done", "complete_with_errors"].includes(
      String(existing.status),
    );
    // Retry / re-import must re-kick stuck OR in-flight orphaned states
    // (processing/split) — previously only error/queued were rekicked, so
    // Retry after poll-timeout was a no-op.
    const needsRekick = !terminalOk && [
      "error", "failed", "queued", "pending", "processing", "split",
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
      const terminalOk = ["complete", "ready", "done", "complete_with_errors"].includes(
        String(raced.status),
      );
      if (rekickIfStuck && !terminalOk) {
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
  });

  return { ok: true, documentId, status: "queued", deduped: false, queued: true };
}

interface QueueLocalArgs {
  tenantId: string;
  userId: string;
  projectId: string;
  documentId: string;
  originalPath: string;
}

/** Kick page-split for a PDF already in plans-bucket (local/multipart upload). */
export async function queueLocalDocumentForPageSplit(args: QueueLocalArgs): Promise<void> {
  const { tenantId, userId, projectId, documentId, originalPath } = args;
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  await anyDb.from("documents").update({
    status: "queued",
    split_status: "pending",
    processing_started_at: new Date().toISOString(),
    last_error: null,
    last_error_step: null,
  }).eq("id", documentId).eq("tenant_id", tenantId);

  void invokePageSplitWorker({
    document_id: documentId,
    tenant_id: tenantId,
    project_id: projectId,
    original_path: originalPath,
    is_local_upload: true,
    user_id: userId,
  }).then(async () => {
    await logDocumentProcessingEvent({
      tenantId,
      projectId,
      documentId,
      step: "split",
      status: "started",
      worker: "portal:queue-local",
    });
  }).catch(async (err) => {
    console.error("[queueLocalDocumentForPageSplit] invoke failed", err);
    const detail = err instanceof Error ? err.message : String(err);
    await anyDb.from("documents").update({
      status: "error",
      last_error: detail.slice(0, 1000),
      last_error_step: "page_split_worker_invoke",
    }).eq("id", documentId).eq("tenant_id", tenantId);
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
}): Promise<void> {
  const { db, documentId, tenantId, projectId, userId, accessToken, driveFileId, originalPath, source } = args;

  await db.from("documents").update({
    status: "queued",
    split_status: "pending",
    processing_started_at: new Date().toISOString(),
    last_error: null,
    last_error_step: null,
  }).eq("id", documentId).eq("tenant_id", tenantId);

  void invokePageSplitWorker({
    document_id: documentId,
    tenant_id: tenantId,
    project_id: projectId,
    drive_file_id: driveFileId,
    original_path: originalPath,
    access_token: accessToken,
    user_id: userId,
  }).then(async () => {
    await logDocumentProcessingEvent({
      tenantId,
      projectId,
      documentId,
      step: "split",
      status: "started",
      worker: source,
    });
  }).catch(async (err) => {
    console.error(`[${source}] page-split invoke failed`, err);
    const detail = err instanceof Error ? err.message : String(err);
    await db.from("documents").update({
      status: "error",
      last_error: detail.slice(0, 1000),
      last_error_step: "page_split_worker_invoke",
    }).eq("id", documentId).eq("tenant_id", tenantId);
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
  });
}
