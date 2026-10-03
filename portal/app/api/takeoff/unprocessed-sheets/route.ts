import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { reclaimStuckProcessingSheets } from "@/lib/documents/reclaimStuck";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const projectId = req.nextUrl.searchParams.get("project_id");
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);

    const db = await createServiceClient();
    void reclaimStuckProcessingSheets(db, tenantId).catch((err) =>
      console.error("[GET /api/takeoff/unprocessed-sheets] stuck reclaim failed", err),
    );

    let query = db
      .from("sheets")
      .select(
        "id, tenant_id, project_id, document_id, document_page_id, page_number, processing_status, is_calibrated, updated_at, documents(file_name), projects(name)",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("is_calibrated", false)
      .order("updated_at", { ascending: true });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: `[GET /api/takeoff/unprocessed-sheets] ${error.message}` }, { status: 500 });
    }

    const sheets = (data ?? []).map((row) => {
      const doc = row.documents as { file_name?: string } | null;
      const proj = row.projects as { name?: string } | null;
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        project_id: row.project_id,
        document_id: row.document_id,
        document_page_id: row.document_page_id,
        page_number: row.page_number,
        processing_status: row.processing_status,
        is_calibrated: row.is_calibrated,
        updated_at: row.updated_at,
        file_name: doc?.file_name ?? null,
        project_name: proj?.name ?? null,
      };
    });

    return NextResponse.json({
      sheets,
      ...paginationMeta(page, limit, count ?? 0),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
