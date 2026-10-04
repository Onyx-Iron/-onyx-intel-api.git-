/**
 * Shared path for importing raw plan bytes (Gmail, Dropbox, ShareFile)
 * into the same documents + ingest/page-split pipeline as local upload.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { PLANS_BUCKET } from "@/lib/documents/storage";
import {
  queueLocalDocumentForPageSplit,
  shouldAsyncSplitPdf,
} from "@/lib/documents/queuePageSplit";
import { logEvent, type EntityType } from "@/lib/activity";
import { auditInsert } from "@/lib/audit";
import { buildIngestKickRequest, shouldMarkIngestStartError } from "@/lib/documents/ingest-start";
import type { TablesInsert } from "@/lib/supabase/types";

const PROJECT_DOCS_BUCKET = "project-documents";

export interface ImportBytesArgs {
  tenantId: string;
  userId: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  source: "gmail" | "dropbox" | "sharefile" | "cloud";
  sourceMeta?: Record<string, unknown>;
  eventEntityType?: EntityType;
  /** Absolute origin for fire-and-forget ingest (e.g. req.nextUrl.origin). */
  origin?: string;
  /** Clerk session from the importing request. Ingest rejects a cookieless kick. */
  cookie?: string | null;
}

export interface ImportBytesResult {
  documentId: string;
  status: string;
  asyncSplit: boolean;
  storagePath: string;
}

export async function importPlanBytes(args: ImportBytesArgs): Promise<ImportBytesResult> {
  const {
    tenantId, userId, projectId, fileName, mimeType, bytes, source, sourceMeta, origin,
  } = args;
  const db = await createServiceClient();
  const docId = crypto.randomUUID();
  const fileSize = bytes.byteLength;
  const asyncSplit = shouldAsyncSplitPdf(fileName, fileSize);
  const bucket = asyncSplit ? PLANS_BUCKET : PROJECT_DOCS_BUCKET;
  const safeName = fileName.replace(/[^\w.\-]+/g, "_");
  const storagePath = asyncSplit
    ? `originals/${docId}.pdf`
    : `${tenantId}/${projectId}/${Date.now()}-${safeName}`;

  const { error: uploadErr } = await db.storage
    .from(bucket)
    .upload(storagePath, bytes, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });
  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  const insertRow: TablesInsert<"documents"> = {
    id: docId,
    tenant_id: tenantId,
    project_id: projectId,
    file_name: fileName,
    status: asyncSplit ? "queued" : "pending",
    uploaded_at: new Date().toISOString(),
    meta: buildDocumentRevisionMeta(fileName, {
      source,
      storage: asyncSplit ? PLANS_BUCKET : "supabase",
      storage_path: storagePath,
      size: fileSize,
      content_type: mimeType || "application/octet-stream",
      ...(sourceMeta ?? {}),
    }),
  };

  const { data: doc, error } = await db
    .from("documents")
    .insert(insertRow)
    .select("id, file_name, status")
    .single();
  if (error || !doc) {
    throw new Error(`[insert] ${error?.message ?? "unknown"}`);
  }

  auditInsert({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "documents",
    record_id: doc.id,
    new_values: insertRow as unknown as Record<string, unknown>,
  });

  if (asyncSplit) {
    await queueLocalDocumentForPageSplit({
      tenantId,
      userId,
      projectId,
      documentId: doc.id,
      originalPath: storagePath,
    });
  } else if (origin) {
    const kick = buildIngestKickRequest({
      origin,
      documentId: doc.id,
      cookie: args.cookie,
    });
    void fetch(kick.url, {
      method: "POST",
      headers: kick.headers,
      body: kick.body,
    }).then(async (res) => {
      if (!shouldMarkIngestStartError(res.status)) return;
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      await db.from("documents").update({
        status: "error",
        last_error: `Ingest failed to start (${res.status}): ${detail}`.slice(0, 2000),
        last_error_step: "ingest_start",
      }).eq("id", doc.id).eq("tenant_id", tenantId).in("status", ["pending", "processing", "queued"]);
    }).catch(async (err) => {
      console.error("[importPlanBytes] ingest fire failed", err);
      try {
        await db.from("documents").update({
          status: "error",
          last_error: `Ingest request failed to start: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
          last_error_step: "ingest_start",
        }).eq("id", doc.id).eq("tenant_id", tenantId).in("status", ["pending", "processing", "queued"]);
      } catch (markErr) {
        console.error("[importPlanBytes] failed to mark document error", markErr);
      }
    });
  }

  void logEvent({
    projectId,
    tenantId,
    userId,
    entityType: args.eventEntityType ?? (source === "gmail" ? "email_import" : "cloud_import"),
    entityId: doc.id,
    action: "imported",
    title: `Imported plan from ${source}: ${fileName}`,
    meta: {
      href: `/dashboard/projects/${projectId}`,
      source,
      size: fileSize,
      async_split: asyncSplit,
      ...(sourceMeta ?? {}),
    },
  });

  return {
    documentId: doc.id,
    status: asyncSplit ? "queued" : "pending",
    asyncSplit,
    storagePath,
  };
}
