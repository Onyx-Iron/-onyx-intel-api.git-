import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { ensureProjectDriveFolder } from "@/lib/google/projectFolder";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";

/**
 * POST /api/takeoff/drive-upload-session
 *
 * Body: { project_id, file_name, size, content_type }
 *
 * Large local-upload takeoff files now go to the estimator's Google Drive
 * instead of Supabase Storage — Drive has no file-size ceiling to fight
 * (Supabase's global Storage limit is 50MB on the Free plan, hard-capped
 * regardless of per-bucket settings), and once the file lands in Drive it
 * flows through the SAME drive_file_id pipeline Drive imports already use
 * (page-split-worker's Drive-fetch branch), so nothing downstream changes.
 *
 * Returns a Google Drive resumable-upload session URI, shaped exactly like
 * upload-url's `{ document_id, upload: { url, method } }` response so the
 * client's PUT step doesn't need to know which storage backend it's
 * talking to. The browser PUTs bytes directly to Drive — this route never
 * touches the file body, so Vercel's request size/duration limits don't
 * apply here either.
 *
 * The Drive file id is only known once the client's PUT completes (Drive
 * returns it in the response body), so the client must call
 * /finalize afterward with that id before running takeoff.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      file_name?: string;
      size?: number;
      content_type?: string;
    };
    const project_id = body.project_id;
    const file_name  = body.file_name;
    const content_type = body.content_type || "application/octet-stream";
    if (!project_id || !file_name) {
      return NextResponse.json({ error: "project_id and file_name are required" }, { status: 400 });
    }
    if (typeof body.size === "number" && body.size > 5 * 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds the 5 GB limit." }, { status: 413 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data: project, error: projErr } = await db
      .from("projects").select("id").eq("id", project_id).eq("tenant_id", tenantId).single();
    if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const folder = await ensureProjectDriveFolder(tenantId, userId, project_id);
    if (!folder) {
      return NextResponse.json({
        error: "Google isn't connected for this workspace yet. Click Connect Google and retry.",
        code: "NEED_GOOGLE",
      }, { status: 412 });
    }

    // Initiate a Drive resumable upload session — this call only registers
    // the intent to upload; the actual bytes go straight from the browser
    // to the returned session URI.
    const sessionRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${folder.token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": content_type,
        ...(typeof body.size === "number" ? { "X-Upload-Content-Length": String(body.size) } : {}),
      },
      body: JSON.stringify({ name: file_name, parents: [folder.folderId] }),
    });
    if (!sessionRes.ok) {
      const detail = await sessionRes.text().catch(() => sessionRes.statusText);
      return NextResponse.json({ error: `Could not start Drive upload session: ${detail.slice(0, 300)}` }, { status: 502 });
    }
    const sessionUrl = sessionRes.headers.get("Location") || sessionRes.headers.get("location");
    if (!sessionUrl) {
      return NextResponse.json({ error: "Drive did not return an upload session URL" }, { status: 502 });
    }

    // Pre-insert the document row — drive_file_id isn't known yet (Drive only
    // returns it once the upload completes); /finalize fills it in.
    const documentId = crypto.randomUUID();
    const insertRow: TablesInsert<"documents"> = {
      id: documentId,
      tenant_id: tenantId,
      project_id,
      file_name,
      status: "queued",
      uploaded_at: new Date().toISOString(),
      meta: buildDocumentRevisionMeta(file_name, {
        source: "local_upload",
        storage: "google_drive",
        pending_drive_upload: true,
        size: body.size ?? null,
        content_type,
      }),
    };
    const { error: insertErr } = await db.from("documents").insert(insertRow);
    if (insertErr) {
      return NextResponse.json({ error: `[insert] ${insertErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      document_id: documentId,
      upload: { url: sessionUrl, method: "PUT" as const },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[takeoff/drive-upload-session] ${msg}` }, { status: 500 });
  }
}
