import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

const PLANS_BUCKET = "plans-bucket";

/**
 * Returns a short-lived signed URL to a single-page PDF for canvas rendering.
 *
 * GET ?page_id=...
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: page, error } = await (db as any)
    .from("document_pages")
    .select("id, storage_path, page_number, document_id")
    .eq("id", pageId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signed, error: signErr } = await (db.storage.from(PLANS_BUCKET) as any)
    .createSignedUrl(page.storage_path, 60 * 30); // 30 min
  if (signErr || !signed) {
    return NextResponse.json({ error: `Storage signing failed: ${signErr?.message ?? "unknown"}` }, { status: 500 });
  }

  return NextResponse.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    url: (signed as any).signedUrl ?? (signed as any).signedURL,
    page_number: page.page_number,
    document_id: page.document_id,
  });
}
