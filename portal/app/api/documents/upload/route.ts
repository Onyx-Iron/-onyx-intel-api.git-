import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { VERCEL_SAFE_UPLOAD_BYTES } from "@/lib/documents/signed-upload";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { getAccessTokenWithReason } from "@/lib/google/oauth";
import { logEvent } from "@/lib/activity";
import { auditInsert } from "@/lib/audit";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "project-documents";

/**
 * Unified document upload entry point.
 *
 * Prefer `/api/documents/upload-url` + browser PUT/TUS for plan PDFs / DWGs —
 * that path never streams binaries through Vercel (avoids 413 / 4.5MB limits).
 *
 * Two legacy modes remain, selected by `storage_type` (or Content-Type):
 *
 *  - storage_type:"drive" (default for JSON requests) — body is JSON:
 *      { project_id, file_name, content_type?, size?, drive_file_id? }
 *    If `drive_file_id` is NOT provided: opens a Drive resumable upload session
 *    and returns { upload_url }. If provided: inserts the row + fires ingest.
 *
 *  - storage_type:"supabase" (multipart) — small files only (< ~3.5MB). Larger
 *    multipart bodies are rejected with guidance to use upload-url.
 *
 * Ingest is fire-and-forget in both branches.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    const contentType = req.headers.get("content-type") ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    // ---------- Supabase Storage branch ----------
    if (isMultipart) {
      const form = await req.formData();
      const file = form.get("file");
      const project_id = String(form.get("project_id") ?? "");
      const storage_type = String(form.get("storage_type") ?? "supabase");
      if (storage_type !== "supabase") {
        return NextResponse.json(
          { error: "multipart uploads only support storage_type=supabase" },
          { status: 400 },
        );
      }
      if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
      if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });
      if (file.size > VERCEL_SAFE_UPLOAD_BYTES) {
        return NextResponse.json({
          error: "File too large for multipart upload through Vercel. Use POST /api/documents/upload-url then PUT directly to Storage.",
          code: "USE_SIGNED_UPLOAD",
          max_bytes: VERCEL_SAFE_UPLOAD_BYTES,
        }, { status: 413 });
      }

      try {
        await assertProjectBelongsToTenant(project_id, tenantId);
      } catch (err) {
        const owned = ownershipDenied(err);
        if (owned) return owned;
        throw err;
      }

      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const storagePath = `${tenantId}/${project_id}/${Date.now()}-${safeName}`;
      const bytes = Buffer.from(await file.arrayBuffer());

      const { error: uploadErr } = await db.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadErr) {
        return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 });
      }

      const insertRow: TablesInsert<"documents"> = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        project_id,
        file_name: file.name,
        status: "pending",
        uploaded_at: new Date().toISOString(),
        meta: buildDocumentRevisionMeta(file.name, {
          source: "local_upload",
          storage: "supabase",
          storage_path: storagePath,
          size: bytes.length,
          content_type: file.type || "application/octet-stream",
        }),
      };
      const { data: doc, error } = await db
        .from("documents").insert(insertRow).select("id, file_name, status").single();
      if (error || !doc) return NextResponse.json({ error: `[insert] ${error?.message}` }, { status: 500 });

      auditInsert({
        tenant_id: tenantId,
        user_id: userId,
        table_name: "documents",
        record_id: doc.id,
        new_values: insertRow as unknown as Record<string, unknown>,
      });

      fireIngest(req, doc.id);
      void logEvent({
        projectId: project_id,
        tenantId,
        userId,
        entityType: "document",
        entityId: doc.id,
        action: "uploaded",
        title: `Document uploaded: ${file.name}`,
        meta: { size: bytes.length, content_type: file.type || "application/octet-stream" },
      });

      return NextResponse.json({
        document: { id: doc.id, file_name: file.name, status: "pending", storage_path: storagePath },
      });
    }

    // ---------- Drive branch ----------
    const body = await req.json() as {
      storage_type?: "drive" | "supabase";
      project_id?: string;
      file_name?: string;
      content_type?: string;
      mime_type?: string;
      size?: number;
      drive_file_id?: string;
    };
    const storage_type = body.storage_type ?? "drive";
    if (storage_type !== "drive") {
      return NextResponse.json(
        { error: `Unsupported storage_type "${storage_type}" for JSON request` },
        { status: 400 },
      );
    }

    const { project_id, file_name, drive_file_id } = body;
    const content_type = body.content_type ?? body.mime_type ?? "application/octet-stream";
    if (!project_id || !file_name) {
      return NextResponse.json({ error: "project_id and file_name required" }, { status: 400 });
    }

    try {
      await assertProjectBelongsToTenant(project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    // Case A: caller already finished a Drive upload → just register the row.
    if (drive_file_id) {
      const inserted = await insertDriveRow({
        db, tenantId, userId, projectId: project_id, fileName: file_name,
        driveFileId: drive_file_id, mimeType: content_type, size: body.size ?? null,
      });
      if ("error" in inserted) return NextResponse.json(inserted, { status: inserted.status });

      const TERMINAL = new Set(["complete", "ready", "done"]);
      if (!inserted.deduped || !TERMINAL.has(inserted.status)) {
        fireIngest(req, inserted.id);
      }
      return NextResponse.json({
        document: {
          id: inserted.id,
          file_name,
          status: inserted.status,
          drive_file_id,
        },
        deduped: inserted.deduped,
      });
    }

    // Case B: caller wants a resumable upload URL.
    const { token, reason, detail } = await getAccessTokenWithReason(tenantId, userId);
    if (!token) {
      if (reason === "refresh_failed") {
        return NextResponse.json({
          error: `Google sign-in expired or was revoked (${detail ?? "refresh failed"}). Click "From Drive" to reconnect Google, then try uploading again.`,
          code: "GOOGLE_REFRESH_FAILED",
        }, { status: 412 });
      }
      return NextResponse.json({
        error: "Google Drive is not connected. Click the Google Drive button to connect, then try again.",
        code: "NEED_GOOGLE",
      }, { status: 412 });
    }

    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": content_type,
        },
        body: JSON.stringify({ name: file_name }),
      },
    );
    if (!initRes.ok) {
      const errDetail = await initRes.text().catch(() => "");
      return NextResponse.json({
        error: `Could not start Drive upload (${initRes.status}): ${errDetail.slice(0, 200)}`,
      }, { status: 502 });
    }
    const upload_url = initRes.headers.get("location");
    if (!upload_url) {
      return NextResponse.json({ error: "Drive did not return an upload URL" }, { status: 502 });
    }

    return NextResponse.json({ upload_url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/documents/upload] ${msg}` }, { status: 500 });
  }
}

// ---------- helpers ----------

async function insertDriveRow(args: {
  db: Awaited<ReturnType<typeof createServiceClient>>;
  tenantId: string;
  userId: string;
  projectId: string;
  fileName: string;
  driveFileId: string;
  mimeType: string;
  size: number | null;
}): Promise<{ id: string; deduped: boolean; status: string } | { error: string; status: number }> {
  const { db, tenantId, userId, projectId, fileName, driveFileId, mimeType, size } = args;

  const documentId = crypto.randomUUID();
  const originalPath = `originals/${documentId}.pdf`;
  const insertRow: TablesInsert<"documents"> = {
    id: documentId,
    tenant_id: tenantId,
    project_id: projectId,
    file_name: fileName,
    status: "processing",
    drive_file_id: driveFileId,
    uploaded_at: new Date().toISOString(),
    meta: buildDocumentRevisionMeta(fileName, {
      source: "google_drive",
      drive_file_id: driveFileId,
      size: size ?? null,
      storage: "plans-bucket",
      storage_path: originalPath,
      content_type: mimeType,
    }),
  };
  const { data: doc, error } = await db
    .from("documents").insert(insertRow).select("id, status").single();
  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await db
        .from("documents")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("drive_file_id", driveFileId)
        .maybeSingle();
      if (existing) return { id: existing.id, deduped: true, status: existing.status };
    }
    return { error: `[insert] ${error.message}`, status: 500 };
  }
  if (!doc) return { error: "[insert] no row returned", status: 500 };
  auditInsert({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "documents",
    record_id: doc.id,
    new_values: insertRow as unknown as Record<string, unknown>,
  });
  return { id: doc.id, deduped: false, status: doc.status };
}

function fireIngest(req: NextRequest, docId: string): void {
  // Fire-and-forget: do NOT await, so the upload response stays fast.
  // If the ingest request never starts (network/platform failure), mark the
  // document errored so it cannot sit in "processing" forever with no worker.
  void fetch(new URL(`/api/documents/${docId}/ingest`, req.url).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": req.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({}),
  }).then(async (res) => {
    if (res.ok) return;
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    try {
      const { createServiceClient } = await import("@/lib/supabase/server");
      const db = await createServiceClient();
      await db.from("documents").update({
        status: "error",
        last_error: `Ingest failed to start (${res.status}): ${detail}`.slice(0, 2000),
        last_error_step: "ingest_start",
      }).eq("id", docId).in("status", ["processing", "pending"]);
    } catch (err) {
      console.error("[fireIngest] failed to mark document error", err);
    }
  }).catch(async (err) => {
    console.error("[fireIngest] fetch failed", err);
    try {
      const { createServiceClient } = await import("@/lib/supabase/server");
      const db = await createServiceClient();
      await db.from("documents").update({
        status: "error",
        last_error: `Ingest request failed to start: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
        last_error_step: "ingest_start",
      }).eq("id", docId).in("status", ["processing", "pending"]);
    } catch (markErr) {
      console.error("[fireIngest] failed to mark document error", markErr);
    }
  });
}
