import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { selectPriorRevision, type RevisionCandidate } from "@/lib/documents/revisions";
import { PLANS_BUCKET } from "@/lib/documents/storage";

export const runtime = "nodejs";

/**
 * Signed URL for the previous revision of this sheet, same family and
 * page number, next-lower revision_rank. Used as a red ghost overlay.
 *
 * GET ?document_id=...&page_number=...
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const documentId = req.nextUrl.searchParams.get("document_id");
  const pageNumber = Number(req.nextUrl.searchParams.get("page_number"));
  if (!documentId || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return NextResponse.json({ error: "document_id and page_number required" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  const { data: current, error } = await db
    .from("documents")
    .select("id, project_id, file_name, uploaded_at, meta")
    .eq("id", documentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !current?.project_id) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data: siblings } = await db
    .from("documents")
    .select("id, file_name, uploaded_at, meta")
    .eq("tenant_id", tenantId)
    .eq("project_id", current.project_id)
    .limit(200);

  const currentDoc: RevisionCandidate = {
    id: current.id,
    file_name: current.file_name,
    uploaded_at: current.uploaded_at,
    meta: (current.meta ?? null) as Record<string, unknown> | null,
  };
  const prior = selectPriorRevision(currentDoc, (siblings ?? []).map((row) => ({
    id: row.id,
    file_name: row.file_name,
    uploaded_at: row.uploaded_at,
    meta: (row.meta ?? null) as Record<string, unknown> | null,
  })));
  if (!prior) return NextResponse.json({ url: null });

  const { data: page } = await db
    .from("document_pages")
    .select("id, storage_path, page_number")
    .eq("tenant_id", tenantId)
    .eq("document_id", prior.id)
    .eq("page_number", pageNumber)
    .maybeSingle();
  if (!page?.storage_path) {
    return NextResponse.json({ url: null, document_id: prior.id, page_id: page?.id ?? null });
  }

  const { data: signed, error: signErr } = await db.storage
    .from(PLANS_BUCKET)
    .createSignedUrl(page.storage_path, 60 * 30);
  const signedUrl = signed?.signedUrl ?? (signed as { signedURL?: string } | null)?.signedURL;
  if (signErr || !signedUrl) {
    return NextResponse.json({ error: `Storage signing failed: ${signErr?.message ?? "unknown"}` }, { status: 500 });
  }

  const meta = prior.meta ?? {};
  const revisionToken = typeof meta.revision_token === "string" ? meta.revision_token : null;
  return NextResponse.json({
    url: signedUrl,
    document_id: prior.id,
    page_id: page.id,
    page_number: page.page_number,
    file_name: prior.file_name,
    revision_token: revisionToken,
  });
}
