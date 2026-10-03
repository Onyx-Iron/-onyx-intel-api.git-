import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/** GET /api/takeoff/canvas/sheets?document_id= → pages in that plan, in order. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const documentId = req.nextUrl.searchParams.get("document_id");
  if (!documentId) return NextResponse.json({ error: "document_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  const { data: doc } = await db
    .from("documents")
    .select("id, file_name, page_count, status")
    .eq("id", documentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data: pages, error } = await db
    .from("document_pages")
    .select("id, page_number, status")
    .eq("tenant_id", tenantId)
    .eq("document_id", documentId)
    .order("page_number", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    document_id: doc.id,
    file_name: doc.file_name,
    status: doc.status,
    page_count: doc.page_count,
    ready: pages?.length ?? 0,
    pages: pages ?? [],
  });
}
