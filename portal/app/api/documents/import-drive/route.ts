import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { buildDocumentRevisionMeta } from "@/lib/documents/revisions";
import { logEvent } from "@/lib/activity";
import { headerSafe } from "@/lib/http";
import type { TablesInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";

/**
 * POST /api/documents/import-drive
 *
 * Body: { project_id, file_id, file_name?, mime_type?, size?, access_token? }
 *
 * Fast-return orchestrator. Does NOT read the Drive file here — Vercel is
 * not a good place to stream large PDFs. Instead:
 *
 *   1. Auth (Clerk), resolve tenant.
 *   2. Validate the caller has google connected (or use the browser-supplied
 *      OAuth `access_token` — server-side, never crosses back to the client).
 *   3. Insert a documents row with status="queued", drive_file_id set,
 *      storage_path reserved under `plans-bucket/originals/{document_id}.pdf`.
 *   4. Kick off the Supabase Edge Function `page-split-worker` via HTTP
 *      (fire-and-forget). The worker streams from Drive → Storage, splits
 *      the PDF with pdf-lib, and populates `document_pages`.
 *   5. Return **202 Accepted** immediately with `{ document_id }`.
 *
 * All heavy work (download, split, per-page Gemini + embeddings) happens
 * inside Supabase Edge Functions so we never touch Vercel's request/response
 * ceilings.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      file_id?: string;
      file_name?: string;
      mime_type?: string;
      size?: number;
      access_token?: string;
    };

    if (!body.project_id || !body.file_id) {
      return NextResponse.json(
        { error: "project_id and file_id are required" },
        { status: 400 },
      );
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

    // Resolve access token: prefer the server-stored refresh-token minted token
    // over a client-supplied one — server-stored means the worker can refresh
    // if the download takes long enough for the token to expire.
    const serverToken = await getAccessToken(tenantId, userId);
    const accessToken = serverToken ?? headerSafe(body.access_token);
    if (!accessToken) {
      return NextResponse.json({
        error: "Google is not connected for this workspace. Click Connect Google and retry.",
        code: "NEED_GOOGLE",
      }, { status: 412 });
    }

    const db = await createServiceClient();

    // Verify project ownership.
    const { data: project, error: projErr } = await db
      .from("projects").select("id").eq("id", body.project_id).eq("tenant_id", tenantId).single();
    if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const fileName = body.file_name?.trim() || `drive-${body.file_id}.pdf`;
    const documentId = crypto.randomUUID();
    const originalPath = `originals/${documentId}.pdf`;

    // Idempotency: if this Drive file was already imported for the project,
    // return the existing row instead of duplicating.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (db as any)
      .from("documents")
      .select("id, status, page_count")
      .eq("tenant_id", tenantId)
      .eq("project_id", body.project_id)
      .eq("drive_file_id", body.file_id)
      .maybeSingle();
    if (existing?.id) {
      return NextResponse.json({
        document_id: existing.id,
        status: existing.status,
        deduped: true,
      }, { status: 202 });
    }

    const insertRow: TablesInsert<"documents"> = {
      id: documentId,
      tenant_id: tenantId,
      project_id: body.project_id,
      file_name: fileName,
      status: "queued",
      drive_file_id: body.file_id,
      uploaded_at: new Date().toISOString(),
      meta: buildDocumentRevisionMeta(fileName, {
        source: "google_drive",
        drive_file_id: body.file_id,
        size: body.size ?? null,
        storage: "plans-bucket",
        storage_path: originalPath,
        content_type: body.mime_type ?? "application/pdf",
      }),
    };
    const { error: insertErr } = await db.from("documents").insert(insertRow);
    if (insertErr) {
      console.error("[import-drive] insert failed", insertErr);
      return NextResponse.json({ error: `[insert] ${insertErr.message}` }, { status: 500 });
    }

    void logEvent({
      projectId: body.project_id,
      tenantId,
      userId,
      entityType: "document",
      entityId: documentId,
      action: "queued",
      title: `Drive import queued: ${fileName}`,
      meta: { drive_file_id: body.file_id },
    });

    // Kick off the worker. Fire-and-forget: we do NOT await the Edge Function
    // response because the client is already getting a 202.
    void invokePageSplitWorker({
      document_id: documentId,
      tenant_id: tenantId,
      project_id: body.project_id,
      drive_file_id: body.file_id,
      original_path: originalPath,
      access_token: accessToken,
      user_id: userId,
    }).catch((err) => {
      console.error("[import-drive] worker invoke failed", err);
    });

    // 202 Accepted — request received, processing continues async.
    return NextResponse.json(
      { document_id: documentId, status: "queued" },
      { status: 202 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/documents/import-drive] ${msg}` }, { status: 500 });
  }
}

// ── Worker invocation --------------------------------------------------------

async function invokePageSplitWorker(payload: {
  document_id: string;
  tenant_id: string;
  project_id: string;
  drive_file_id: string;
  original_path: string;
  access_token: string;
  user_id: string;
}): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/page-split-worker`;
  // Note: we deliberately do NOT await the body. Edge Function boots + acknowledges;
  // heavy work continues in background there.
  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
