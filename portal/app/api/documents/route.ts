import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { auditDelete } from "@/lib/audit";
import { uuidSchema } from "@/lib/validation";
import { reclaimStuckProcessingDocuments, reclaimStuckProcessingPages } from "@/lib/documents/reclaimStuck";
import { finalizeDocumentsFromOcr } from "@/lib/documents/finalizeDocument";
import { parseMaintainFlag } from "../../../supabase/functions/_shared/splitBatch";

/** Columns the Documents UI needs — avoid select("*") on every poll. */
const DOCUMENT_LIST_COLUMNS = [
  "id",
  "file_name",
  "status",
  "split_status",
  "ocr_status",
  "vector_status",
  "takeoff_status",
  "last_error",
  "last_error_step",
  "doc_type",
  "page_count",
  "uploaded_at",
  "processed_at",
  "meta",
  "project_id",
].join(", ");

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("project_id");
    // maintain=1 (default when project-scoped) runs reclaim + OCR finalize.
    // Pass maintain=0 for a cheap refresh after split-status already ran.
    const maintain = parseMaintainFlag(
      req.nextUrl.searchParams.get("maintain"),
      Boolean(projectId),
    );
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);

    const db = await createServiceClient();
    if (maintain) {
      // Scope reclaim/finalize to the project when listing a project — tenant-wide
      // scans on every poll were the hot path for Documents.
      // Reclaim docs + pages in parallel; finalize after so terminal page
      // errors are visible to the OCR rollup.
      await Promise.all([
        reclaimStuckProcessingDocuments(db, tenantId, undefined, projectId).catch((err) =>
          console.error("[GET /api/documents] stuck reclaim failed", err),
        ),
        reclaimStuckProcessingPages(db, tenantId, undefined, undefined, projectId).catch((err) =>
          console.error("[GET /api/documents] stuck page reclaim failed", err),
        ),
      ]);
      await finalizeDocumentsFromOcr(db, tenantId, undefined, projectId).catch((err) =>
        console.error("[GET /api/documents] OCR finalize failed", err),
      );
    }

    let query = db
      .from("documents")
      .select(DOCUMENT_LIST_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("uploaded_at", { ascending: false });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: `[GET /api/documents] ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      documents: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/documents] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const idParse = uuidSchema.safeParse(id);
    if (!idParse.success) {
      return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    // Fetch the document first so we can log the project_id after deletion.
    const { data: docRow } = await db
      .from("documents")
      .select("id, project_id, file_name, status")
      .eq("id", idParse.data)
      .eq("tenant_id", tenantId)
      .single();

    const { error } = await db
      .from("documents")
      .delete()
      .eq("id", idParse.data)
      .eq("tenant_id", tenantId);

    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "documents",
      record_id: idParse.data,
      old_values: (docRow ?? null) as unknown as Record<string, unknown> | null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docProjectId = (docRow as any)?.project_id ?? null;
    if (docProjectId) {
      void logEvent({
        projectId: docProjectId,
        tenantId,
        userId,
        entityType: "document",
        entityId: idParse.data,
        action: "deleted",
        title: "Document deleted",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/documents] ${msg}` }, { status: 500 });
  }
}
