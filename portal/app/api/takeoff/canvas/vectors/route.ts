import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertPageBelongsToProject } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditUpdate } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET  /api/takeoff/canvas/vectors?page_id=  → { vectors: [{layer, points[], type}...] }
 * PUT  { page_id, vectors }                   → stashes the CAD extraction result on the page
 *
 * `vectors` payload shape (one per polyline / bbox):
 *   { layer: "C-SSWR-PIPE",
 *     type: "polyline" | "bbox" | "point",
 *     points: [[x1,y1], [x2,y2], ...],
 *     text_tag?: "8\" SANITARY" }
 *
 * Coordinates are in the SAME units the drawing was parsed in (usually feet).
 * The client rescales to canvas pixel space using the page's calibration.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("document_pages")
    .select("id, vectors, vectors_extracted_at")
    .eq("id", pageId)
    .eq("tenant_id", tenantId)
    .single();
  if (!data) return NextResponse.json({ vectors: [], extracted_at: null });

  return NextResponse.json({
    vectors: Array.isArray(data.vectors) ? data.vectors : (data.vectors?.polylines ?? []),
    extracted_at: data.vectors_extracted_at,
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { page_id?: string; vectors?: unknown };
  if (!body.page_id || !Array.isArray(body.vectors)) {
    return NextResponse.json({ error: "page_id and vectors[] required" }, { status: 400 });
  }
  if (body.vectors.length > 20000) {
    return NextResponse.json({ error: "vectors too large (max 20 000 items)" }, { status: 413 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: page } = await anyDb
    .from("document_pages")
    .select("id, document_id, vectors, vectors_extracted_at")
    .eq("id", body.page_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  const { data: doc } = await anyDb
    .from("documents")
    .select("project_id")
    .eq("id", page.document_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!doc?.project_id) return NextResponse.json({ error: "Page document not found" }, { status: 404 });

  try {
    await assertPageBelongsToProject(body.page_id, doc.project_id, tenantId);
  } catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const { error } = await anyDb
    .from("document_pages")
    .update({
      vectors: body.vectors,
      vectors_extracted_at: new Date().toISOString(),
    })
    .eq("id", body.page_id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditUpdate({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "document_pages",
    record_id: body.page_id,
    old_values: { vectors: page.vectors, vectors_extracted_at: page.vectors_extracted_at } as unknown as Record<string, unknown>,
    new_values: { vectors: body.vectors, count: body.vectors.length } as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, count: body.vectors.length });
}
