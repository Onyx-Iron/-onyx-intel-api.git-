import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { mimeTypeForFile, originalStoragePath, PLANS_BUCKET } from "@/lib/documents/upload-plan";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { getAccessTokenWithReason } from "@/lib/google/oauth";
import { logEvent } from "@/lib/activity";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Unified document upload entry point.
 *
 * Two modes, selected by `storage_type` (or the request Content-Type):
 *
 *  - storage_type:"drive" (default for JSON requests) — body is JSON:
 *      { project_id, file_name, content_type?, size?, drive_file_id? }
 *    If `drive_file_id` is NOT provided: opens a Drive resumable upload session
 *    and inserts a documents row in one shot; returns { upload_url, document }.
 *    If `drive_file_id` IS provided: the browser already finished a Drive PUT
 *    (e.g. via the Drive picker, or a back-compat call from register-drive);
 *    we just insert the row.
 *
 *  - storage_type:"supabase" (default for multipart requests) — body is multipart
 *    with `file` and `project_id`. Bytes are uploaded to Supabase Storage server-side.
 *
 * Ingest is fire-and-forget in both branches.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
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

      const { data: project, error: projErr } = await db
        .from("projects").select("id").eq("id", project_id).eq("tenant_id", tenantId).single();
      if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

      const documentId = crypto.randomUUID();
      const storagePath = originalStoragePath(documentId, file.name);
      const contentType = mimeTypeForFile(file.name, file.type);
      const bytes = Buffer.from(await file.arrayBuffer());

      const { error: uploadErr } = await db.storage
        .from(PLANS_BUCKET)
        .upload(storagePath, bytes, { contentType, upsert: false });
      if (uploadErr) {
        return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 });
      }

      const insertRow: TablesInsert<"documents"> = {
        id: documentId,
        tenant_id: tenantId,
        project_id,
        file_name: file.name,
        status: "pending",
        uploaded_at: new Date().toISOString(),
        meta: buildDocumentRevisionMeta(file.name, {
          source: "local_upload",
          storage: PLANS_BUCKET,
          storage_path: storagePath,
          size: bytes.length,
          content_type: contentType,
        }),
      };
      const { data: doc, error } = await db
        .from("documents").insert(insertRow).select("id, file_name, status").single();
      if (error || !doc) return NextResponse.json({ error: `[insert] ${error?.message}` }, { status: 500 });

      fireIngest(req, doc.id);
      void logEvent({
        projectId: project_id,
        tenantId,
        userId,
        entityType: "document",
        entityId: doc.id,
        action: "uploaded",
        title: `Document uploaded: ${file.name}`,
        meta: { size: bytes.length, content_type: contentType },
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
    if (!project_id || !file_name) {
      return NextResponse.json({ error: "project_id and file_name required" }, { status: 400 });
    }
    const content_type = mimeTypeForFile(file_name, body.content_type ?? body.mime_type);

    const { data: project, error: projErr } = await db
      .from("projects").select("id").eq("id", project_id).eq("tenant_id", tenantId).single();
    if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Case A: caller already finished a Drive upload → just register the row.
    if (drive_file_id) {
      const inserted = await insertDriveRow({
        db, tenantId, projectId: project_id, fileName: file_name,
        driveFileId: drive_file_id, mimeType: content_type, size: body.size ?? null,
      });
      if ("error" in inserted) return NextResponse.json(inserted, { status: inserted.status });

      fireIngest(req, inserted.id);
      return NextResponse.json({
        document: {
          id: inserted.id,
          file_name,
          status: "processing",
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
          ...(typeof body.size === "number" && Number.isFinite(body.size)
            ? { "X-Upload-Content-Length": String(body.size) }
            : {}),
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
  projectId: string;
  fileName: string;
  driveFileId: string;
  mimeType: string;
  size: number | null;
}): Promise<{ id: string; deduped: boolean } | { error: string; status: number }> {
  const { db, tenantId, projectId, fileName, driveFileId, mimeType, size } = args;

  // Explicit check-then-insert dedupe (the race-proof partial unique index
  // isn't applied to the DB yet). Idempotent across browser retries on the
  // same (tenant, project, drive_file_id).
  const { data: existing } = await db
    .from("documents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("drive_file_id", driveFileId)
    .maybeSingle();
  if (existing) return { id: existing.id, deduped: true };

  const insertRow: TablesInsert<"documents"> = {
    id: crypto.randomUUID(),
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
      storage: "drive",
      content_type: mimeType,
    }),
  };
  const { data: doc, error } = await db
    .from("documents").insert(insertRow).select("id").single();
  if (error || !doc) return { error: `[insert] ${error?.message}`, status: 500 };
  return { id: doc.id, deduped: false };
}

function fireIngest(req: NextRequest, docId: string): void {
  // Fire-and-forget: do NOT await, so the upload response stays fast.
  void fetch(new URL(`/api/documents/${docId}/ingest`, req.url).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": req.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({}),
  }).catch(() => {});
}
