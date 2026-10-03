import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { logEvent } from "@/lib/activity";
import { queueDriveDocumentForPageSplit } from "@/lib/documents/queuePageSplit";

export const runtime = "nodejs";
/** Covers after()-scheduled page-split invoke for large Drive plans. */
export const maxDuration = 300;

/**
 * POST /api/documents/import-drive
 *
 * @deprecated Prefer POST /api/documents/upload (storage_type=drive), which
 * registers the row and auto-fires ingest or page-split for large PDFs.
 * This route remains for API/back-compat callers only — the UI uses upload.
 *
 * Body: { project_id, file_id, file_name?, mime_type?, size? }
 *
 * Queues the Drive file onto page-split-worker and returns 202 immediately.
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
    };

    if (!body.project_id || !body.file_id) {
      return NextResponse.json(
        { error: "project_id and file_id are required" },
        { status: 400 },
      );
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    try {
      await assertProjectBelongsToTenant(body.project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }

    const fileName = body.file_name?.trim() || `drive-${body.file_id}.pdf`;
    const queued = await queueDriveDocumentForPageSplit({
      tenantId,
      userId,
      projectId: body.project_id,
      driveFileId: body.file_id,
      fileName,
      mimeType: body.mime_type,
      sizeBytes: body.size ?? null,
      rekickIfStuck: true,
    });

    if (!queued.ok) {
      return NextResponse.json(
        { error: queued.error, code: queued.code },
        { status: queued.status },
      );
    }

    if (!queued.deduped) {
      void logEvent({
        projectId: body.project_id,
        tenantId,
        userId,
        entityType: "document",
        entityId: queued.documentId,
        action: "queued",
        title: `Drive import queued: ${fileName}`,
        meta: { drive_file_id: body.file_id },
      });
    }

    return NextResponse.json(
      {
        document_id: queued.documentId,
        status: queued.status,
        deduped: queued.deduped,
      },
      { status: 202 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/documents/import-drive] ${msg}` }, { status: 500 });
  }
}
