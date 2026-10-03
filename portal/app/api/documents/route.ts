import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { uuidSchema } from "@/lib/validation";
import { reclaimStuckProcessingDocuments, reclaimStuckProcessingPages } from "@/lib/documents/reclaimStuck";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("project_id");
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);

    const db = await createServiceClient();
    // Opportunistic reclaim: docs/pages left in "processing" after a platform
    // kill never get markError() — surface them as retryable errors on list.
    void reclaimStuckProcessingDocuments(db, tenantId).catch((err) =>
      console.error("[GET /api/documents] stuck reclaim failed", err),
    );
    void reclaimStuckProcessingPages(db, tenantId).catch((err) =>
      console.error("[GET /api/documents] stuck page reclaim failed", err),
    );

    let query = db
      .from("documents")
      .select("*", { count: "exact" })
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
    const db = await createServiceClient();

    // Fetch the document first so we can log the project_id after deletion.
    const { data: docRow } = await db
      .from("documents")
      .select("project_id")
      .eq("id", idParse.data)
      .eq("tenant_id", tenantId)
      .single();

    const { error } = await db
      .from("documents")
      .delete()
      .eq("id", idParse.data)
      .eq("tenant_id", tenantId);

    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

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
