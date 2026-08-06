import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { logDocumentProcessingEvent } from "@/lib/documents/processingEvents";
import { buildRetryDocumentUpdate, canRetryDocument } from "@/lib/documents/retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function kickOffIngest(documentId: string, req: NextRequest): Promise<void> {
  const res = await fetch(new URL(`/api/documents/${documentId}/ingest`, req.url).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": req.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ingest ${res.status}: ${detail.slice(0, 300)}`);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<unknown> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: documentId } = (await params) as { id: string };
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data: document, error: documentError } = await db
      .from("documents")
      .select("id, project_id, file_name, drive_file_id, status, meta")
      .eq("id", documentId)
      .eq("tenant_id", tenantId)
      .single();
    if (documentError || !document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const meta = (document.meta ?? {}) as Record<string, unknown>;
    const driveFileId = document.drive_file_id ?? (typeof meta.drive_file_id === "string" ? meta.drive_file_id : null);
    if (!canRetryDocument({ drive_file_id: driveFileId, meta })) {
      return NextResponse.json({ error: "This document has no retriable source" }, { status: 422 });
    }

    await db.from("documents")
      .update(buildRetryDocumentUpdate(new Date().toISOString()))
      .eq("id", documentId)
      .eq("tenant_id", tenantId);

    await logDocumentProcessingEvent({
      tenantId,
      projectId: document.project_id,
      documentId,
      step: "indexing",
      status: "started",
      worker: "portal:documents-retry",
    });

    void kickOffIngest(documentId, req).catch(async (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      await db.from("documents")
        .update({ status: "error", last_error: detail.slice(0, 2000), last_error_step: "retry_ingest" })
        .eq("id", documentId)
        .eq("tenant_id", tenantId);
      await logDocumentProcessingEvent({
        tenantId,
        projectId: document.project_id,
        documentId,
        step: "indexing",
        status: "failed",
        worker: "portal:documents-retry",
        errorCode: "retry_failed",
        errorMessage: detail,
      });
    });

    return NextResponse.json({ ok: true, document_id: documentId, status: "processing" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/documents/:id/retry] ${msg}` }, { status: 500 });
  }
}
