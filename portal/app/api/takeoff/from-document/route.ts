import { auth, currentUser } from "@clerk/nextjs/server";
import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { headerSafe } from "@/lib/http";
import { getAccessToken } from "@/lib/google/oauth";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { pythonApiHeaders } from "@/lib/python-api";
import { invokePageSplitWorker } from "@/lib/documents/pageSplitWorker";
import { pageSplitPipelineHealthy } from "@/lib/documents/pageSplitHealth";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

const PYTHON_API_URL = headerSafe(process.env.PYTHON_API_URL) || "http://localhost:5050";
// Aligned with the Supabase Edge Functions — see `page-split-worker/index.ts`.
const BUCKET = "plans-bucket";

// All document-backed PDFs are routed through the async page-split pipeline.
// We previously only used this for very large files, leaving smaller plan sets
// on the synchronous Railway stream. That created two different extraction
// behaviors, and the sync path could still "complete" with 0 line items on a
// graphical drawing set. Unifying uploaded/Drive PDFs onto the per-page path
// makes behavior deterministic and lets page-level AI fallback recover drawing
// sheets before the document is marked complete.

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Page-by-page takeoff from an already-uploaded document.
 *
 * Document-backed PDFs are handed off to the async page-split pipeline
 * (page-split-worker → page-processor + page-takeoff-worker fan-out per
 * page) so takeoff extraction always happens per-page with page-level
 * fallback/retry semantics. Non-PDF document types still proxy synchronously
 * to Python's /api/takeoff/extract-stream.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { document_id, project_id } = await req.json() as { document_id?: string; project_id?: string };
    if (!document_id || !project_id) {
      return NextResponse.json({ error: "document_id and project_id required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    const db = await createServiceClient();

    const { data: doc, error } = await db
      .from("documents")
      .select("id, file_name, project_id, meta")
      .eq("id", document_id).eq("tenant_id", tenantId).single();
    if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (doc.project_id !== project_id) {
      return NextResponse.json({ error: "Document does not belong to this project" }, { status: 403 });
    }

    const meta = (doc.meta as Record<string, unknown> | null) ?? {};
    const storagePath = meta.storage_path as string | undefined;
    const driveFileId = meta.drive_file_id as string | undefined;
    const localPath = meta.local_path as string | undefined;
    const fileSize = typeof meta.size === "number" ? meta.size : null;
    const isPdf = doc.file_name.toLowerCase().endsWith(".pdf");
    console.info("[from-document] start", {
      document_id,
      project_id,
      file_name: doc.file_name,
      isPdf,
      hasStoragePath: Boolean(storagePath),
      hasDriveFileId: Boolean(driveFileId),
      hasLocalPath: Boolean(localPath),
      fileSize,
      pendingUpload: meta.pending_upload === true,
    });

    if (storagePath && meta.pending_upload === true) {
      const { data: objectInfo, error: infoErr } = await db.storage.from(BUCKET).info(storagePath);
      if (infoErr || !objectInfo) {
        return NextResponse.json({
          error: "The upload has not finished reaching secure storage. Retry the upload before starting extraction.",
          code: "UPLOAD_INCOMPLETE",
        }, { status: 409 });
      }
      const { pending_upload: _pendingUpload, ...completedMeta } = meta;
      void _pendingUpload;
      await db.from("documents")
        .update({ meta: completedMeta as never, status: "processing" } as never)
        .eq("id", document_id).eq("tenant_id", tenantId);
    }

    // ── Large PDF → async page-split pipeline ────────────────────────────────
    // Applies whether the original lives in Supabase Storage (older local
    // uploads) or Google Drive (current default for new local uploads — see
    // /api/takeoff/drive-upload-session) — both feed page-split-worker,
    // just with a different fetch source for the original bytes.
    const shouldUseAsyncPdfPipeline = isPdf && Boolean(storagePath || driveFileId);
    const asyncPipelineReady = shouldUseAsyncPdfPipeline
      ? await pageSplitPipelineHealthy()
      : false;
    console.info("[from-document] routing", {
      document_id,
      shouldUseAsyncPdfPipeline,
      asyncPipelineReady,
    });
    if (shouldUseAsyncPdfPipeline && asyncPipelineReady) {
      const driveToken = driveFileId ? await getAccessToken(tenantId, userId) : null;
      if (driveFileId && !driveToken) {
        return NextResponse.json({
          error: "This plan is in Google Drive, but Google is not connected for this workspace yet. Connect Google or reopen the file from Drive.",
          code: "NEED_GOOGLE",
        }, { status: 412 });
      }
      await db.from("documents")
        .update({
          status: "processing",
          updated_at: new Date().toISOString(),
          processing_started_at: new Date().toISOString(),
          last_error: null,
          last_error_step: null,
        } as never)
        .eq("id", document_id).eq("tenant_id", tenantId);

      const dispatchPageSplit = async () => {
        if (driveFileId) {
          await invokePageSplitWorker({
          document_id,
          tenant_id: tenantId,
          project_id,
          original_path: `originals/${document_id}.pdf`,
          drive_file_id: driveFileId,
          access_token: driveToken!,
          user_id: userId,
        }).then(async () => {
          await logDocumentProcessingEvent({
            tenantId,
            projectId: project_id,
            documentId: document_id,
            step: "split",
            status: "started",
            worker: "portal:from-document",
          });
        }).catch(async (err) => {
          console.error("[from-document] page-split-worker invoke failed", err);
          const detail = err instanceof Error ? err.message : String(err);
          await db.from("documents")
            .update({
              status: "error",
              last_error: detail.slice(0, 1000),
              last_error_step: "page_split_worker_invoke",
            } as never)
            .eq("id", document_id).eq("tenant_id", tenantId);
          await logDocumentProcessingEvent({
            tenantId,
            projectId: project_id,
            documentId: document_id,
            step: "split",
            status: "failed",
            worker: "portal:from-document",
            errorCode: "worker_invoke_failed",
            errorMessage: detail,
          });
        });
        } else {
          await invokePageSplitWorker({
          document_id,
          tenant_id: tenantId,
          project_id,
          original_path: storagePath!,
          is_local_upload: true,
          user_id: userId,
        }).then(async () => {
          await logDocumentProcessingEvent({
            tenantId,
            projectId: project_id,
            documentId: document_id,
            step: "split",
            status: "started",
            worker: "portal:from-document",
          });
        }).catch(async (err) => {
          console.error("[from-document] page-split-worker invoke failed", err);
          const detail = err instanceof Error ? err.message : String(err);
          await db.from("documents")
            .update({
              status: "error",
              last_error: detail.slice(0, 1000),
              last_error_step: "page_split_worker_invoke",
            } as never)
            .eq("id", document_id).eq("tenant_id", tenantId);
          await logDocumentProcessingEvent({
            tenantId,
            projectId: project_id,
            documentId: document_id,
            step: "split",
            status: "failed",
            worker: "portal:from-document",
            errorCode: "worker_invoke_failed",
            errorMessage: detail,
          });
        });
        }
      };

      // Keep the worker invocation alive after the 202 response. Floating
      // promises are routinely terminated by serverless runtimes.
      after(dispatchPageSplit);
      console.info("[from-document] async accepted", { document_id, project_id, file_name: doc.file_name });

      return NextResponse.json({ status: "processing", async: true, document_id }, { status: 202 });
    }

    console.warn("[from-document] sync fallback", {
      document_id,
      file_name: doc.file_name,
      shouldUseAsyncPdfPipeline,
      asyncPipelineReady,
      hasStoragePath: Boolean(storagePath),
      hasDriveFileId: Boolean(driveFileId),
      hasLocalPath: Boolean(localPath),
    });

    // The synchronous Railway stream is also the automatic fallback whenever
    // either Edge worker fails its boot probe. Reset a previously failed
    // document so a retry can complete without requiring a new upload.
    await db.from("documents")
      .update({
        status: "processing",
        last_error: null,
        last_error_step: null,
        processing_started_at: new Date().toISOString(),
      } as never)
      .eq("id", document_id)
      .eq("tenant_id", tenantId);

    let bytes: Buffer;
    if (localPath) {
      // Local-mode: the file lives on this machine's disk.
      const { readFile } = await import("node:fs/promises");
      bytes = await readFile(/* turbopackIgnore: true */ localPath);
    } else if (storagePath) {
      const { data: fileData, error: dlErr } = await db.storage.from(BUCKET).download(storagePath);
      if (dlErr || !fileData) return NextResponse.json({ error: `Could not load file: ${dlErr?.message}` }, { status: 502 });
      bytes = Buffer.from(await fileData.arrayBuffer());
    } else if (driveFileId) {
      // Plan lives in the user's Google Drive – always use the server-stored refresh token.
      // Do NOT accept a browser-supplied bearer token: it would let a client spoof any
      // Google account's Drive read for this tenant.
      const gToken = await getAccessToken(tenantId, userId);
      if (!gToken) {
        return NextResponse.json({
          error: "This plan is in Google Drive, but Google is not connected for this workspace yet. Connect Google or reopen the file from Drive.",
          code: "NEED_GOOGLE",
        }, { status: 412 });
      }
      const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`, {
        headers: { Authorization: `Bearer ${gToken}` },
      });
      if (!driveRes.ok) {
        const d = await driveRes.text().catch(() => driveRes.statusText);
        return NextResponse.json({ error: `Could not load from Drive (${driveRes.status}): ${d.slice(0, 200)}` }, { status: 502 });
      }
      bytes = Buffer.from(await driveRes.arrayBuffer());
    } else {
      return NextResponse.json({ error: "This document has no retrievable file." }, { status: 422 });
    }

    const sourceChecksum = createHash("sha256").update(bytes).digest("hex");
    const { pending_upload: _pendingUpload, ...sourceMeta } = meta;
    void _pendingUpload;
    const { error: checksumUpdateError } = await db.from("documents")
      .update({ meta: { ...sourceMeta, source_checksum: sourceChecksum } as never } as never)
      .eq("id", document_id).eq("tenant_id", tenantId);
    if (checksumUpdateError) {
      return NextResponse.json({ error: `Could not preserve source checksum: ${checksumUpdateError.message}` }, { status: 500 });
    }

    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], doc.file_name));

    const user = await currentUser().catch(() => null);
    const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

    let upstream: Response;
    try {
      upstream = await fetch(`${PYTHON_API_URL}/api/takeoff/extract-stream`, {
        method: "POST",
        headers: pythonApiHeaders({ email, tenantId, projectId: project_id }),
        body: form,
        // @ts-expect-error — Node fetch duplex for streaming
        duplex: "half",
      });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const isOffline = msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("ENOTFOUND");
      return NextResponse.json({
        error: isOffline
          ? "The AI extraction service is offline. Please try again in a moment."
          : `Could not reach extraction service: ${msg.slice(0, 200)}`,
      }, { status: 503 });
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "upstream error");
      return NextResponse.json({ error: `[from-document] upstream ${upstream.status}: ${detail.slice(0, 300)}` }, { status: 502 });
    }

    // Tap the passthrough stream so `documents.status` reflects the outcome
    // once Railway finishes sending — previously this route never touched
    // status at all, so a document stayed "queued" forever regardless of
    // whether extraction actually succeeded. Read manually (rather than a
    // TransformStream) so a mid-stream network error from Railway — not just
    // a client-initiated abort — is caught and recorded as "failed" too.
    const upstreamReader = upstream.body.getReader();
    let settled = false;
    const markDone = async () => {
      if (settled) return;
      settled = true;
      await db.from("documents")
        .update({ status: "complete", processed_at: new Date().toISOString() } as never)
        .eq("id", document_id).eq("tenant_id", tenantId);
    };
    const markFailed = async () => {
      if (settled) return;
      settled = true;
      await db.from("documents")
        .update({ status: "error", last_error_step: "takeoff_stream" } as never)
        .eq("id", document_id).eq("tenant_id", tenantId);
    };

    const tappedStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await upstreamReader.read();
          if (done) {
            controller.close();
            await markDone();
            return;
          }
          controller.enqueue(value);
        } catch (err) {
          controller.error(err);
          await markFailed();
        }
      },
      async cancel(reason) {
        await upstreamReader.cancel(reason).catch(() => {});
        await markFailed();
      },
    });

    return new Response(tappedStream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[from-document] ${msg}` }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
