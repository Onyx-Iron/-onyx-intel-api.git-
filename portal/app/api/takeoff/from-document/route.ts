import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { headerSafe } from "@/lib/http";
import { getAccessToken } from "@/lib/google/oauth";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { pythonApiHeaders } from "@/lib/python-api";

const PYTHON_API_URL = headerSafe(process.env.PYTHON_API_URL) || "http://localhost:5050";
const BUCKET = "project-documents";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Page-by-page takeoff from an already-uploaded document.
 * Downloads the stored file (Supabase storage) and streams it to the Python
 * /api/takeoff/extract-stream endpoint, proxying the NDJSON progress back to the
 * browser. Sidesteps browser upload limits and processes one page at a time.
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
    const db = await createServiceClient();

    const { data: doc, error } = await db
      .from("documents")
      .select("id, file_name, meta")
      .eq("id", document_id).eq("tenant_id", tenantId).single();
    if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const meta = (doc.meta as Record<string, unknown> | null) ?? {};
    const storagePath = meta.storage_path as string | undefined;
    const driveFileId = meta.drive_file_id as string | undefined;
    const localPath = meta.local_path as string | undefined;

    let bytes: Buffer;
    if (localPath) {
      // Local-mode: the file lives on this machine's disk.
      const { readFile } = await import("node:fs/promises");
      bytes = await readFile(localPath);
    } else if (storagePath) {
      const { data: fileData, error: dlErr } = await db.storage.from(BUCKET).download(storagePath);
      if (dlErr || !fileData) return NextResponse.json({ error: `Could not load file: ${dlErr?.message}` }, { status: 502 });
      bytes = Buffer.from(await fileData.arrayBuffer());
    } else if (driveFileId) {
      // Plan lives in the user's Google Drive – download it with their token.
      const browserToken = req.headers.get("x-google-token");
      const gToken = browserToken ?? await getAccessToken(tenantId, userId);
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

    return new Response(upstream.body, {
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
