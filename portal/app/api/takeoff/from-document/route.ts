import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { headerSafe } from "@/lib/http";
import { getAccessToken } from "@/lib/google/oauth";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { pythonApiHeaders } from "@/lib/python-api";
import {
  ASYNC_SPLIT_BYTES,
  queueDriveDocumentForPageSplit,
  queueLocalDocumentForPageSplit,
} from "@/lib/documents/queuePageSplit";

const PYTHON_API_URL = headerSafe(process.env.PYTHON_API_URL) || "http://localhost:5050";
// Aligned with the Supabase Edge Functions — see `page-split-worker/index.ts`.
const BUCKET = "plans-bucket";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Page-by-page takeoff from an already-uploaded document.
 *
 * Large local-upload PDFs (>3.5MB, storage_path-backed) are intercepted here
 * and handed off to the async page-split pipeline (page-split-worker →
 * page-processor + page-takeoff-worker fan-out per page) — the same
 * architecture the Google Drive import path already uses. Everything else
 * (small files, local disk paths, direct Drive reads) still proxies
 * synchronously to Python's /api/takeoff/extract-stream.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { document_id, project_id } = await req.json() as { document_id?: string; project_id?: string };
    if (!document_id || !project_id) {
      return NextResponse.json({ error: "document_id and project_id required" }, { status: 400 });
    }

    const tenantOrgId = authTenantKey(userId, orgId);
    const tenantId = await getOrCreateTenant(tenantOrgId, authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    try {
      await assertProjectBelongsToTenant(project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }
    const db = await createServiceClient();

    const { data: doc, error } = await db
      .from("documents")
      .select("id, file_name, meta")
      .eq("id", document_id).eq("tenant_id", tenantId).eq("project_id", project_id).single();
    if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const meta = (doc.meta as Record<string, unknown> | null) ?? {};
    const storagePath = meta.storage_path as string | undefined;
    const driveFileId = meta.drive_file_id as string | undefined;
    const localPath = meta.local_path as string | undefined;
    const fileSize = typeof meta.size === "number" ? meta.size : null;
    const isPdf = doc.file_name.toLowerCase().endsWith(".pdf");

    // ── Large PDF → async page-split pipeline (shared queue helper) ──────────
    // Missing size is treated as large — safer than silent mid-stream death
    // on the sync Railway path when meta.size was never recorded.
    const isLargePdf = isPdf && (fileSize == null || fileSize >= ASYNC_SPLIT_BYTES);
    if (isLargePdf && (storagePath || driveFileId)) {
      if (driveFileId) {
        const queued = await queueDriveDocumentForPageSplit({
          tenantId,
          userId,
          projectId: project_id,
          driveFileId,
          fileName: doc.file_name,
          mimeType: typeof meta.content_type === "string" ? meta.content_type : "application/pdf",
          sizeBytes: fileSize,
          rekickIfStuck: true,
        });
        if (!queued.ok) {
          return NextResponse.json(
            { error: queued.error, code: queued.code },
            { status: queued.status },
          );
        }
        return NextResponse.json({
          status: "queued",
          async: true,
          document_id: queued.documentId,
          queued: queued.queued,
        }, { status: 202 });
      }

      await queueLocalDocumentForPageSplit({
        tenantId,
        userId,
        projectId: project_id,
        documentId: document_id,
        originalPath: storagePath!,
      });
      return NextResponse.json({ status: "queued", async: true, document_id }, { status: 202 });
    }

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

    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], doc.file_name));

    const user = await currentUser().catch(() => null);
    const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

    let upstream: Response;
    try {
      upstream = await fetch(`${PYTHON_API_URL}/api/takeoff/extract-stream`, {
        method: "POST",
        headers: pythonApiHeaders({ email, tenantId: tenantOrgId, projectId: project_id }),
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
        .update({ status: "done", processed_at: new Date().toISOString() } as never)
        .eq("id", document_id).eq("tenant_id", tenantId);
    };
    const markFailed = async () => {
      if (settled) return;
      settled = true;
      await db.from("documents")
        .update({ status: "failed" } as never)
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
    return NextResponse.json({ error: `[from-document] ${msg}` }, { status: 500 });
  }
}
