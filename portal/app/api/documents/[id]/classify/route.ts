import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { DOCUMENT_CLASSES, normalizeDocumentClass } from "@/lib/documents/processing-display";

export const runtime = "nodejs";

/** Manual document class. Specs and other non-drawings stop emitting quantities. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { doc_type?: string };
  const raw = (body.doc_type ?? "").trim().toLowerCase();
  if (!(DOCUMENT_CLASSES as readonly string[]).includes(raw)) {
    return NextResponse.json({ error: "Unknown document class." }, { status: 400 });
  }
  const docType = normalizeDocumentClass(raw);

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;
  const db = await createServiceClient();
  const { data: doc, error } = await db
    .from("documents")
    .select("id, project_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  try {
    await assertProjectBelongsToTenant(doc.project_id as string, tenantId);
  } catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }
  const { error: updErr } = await db.from("documents").update({ doc_type: docType }).eq("id", id).eq("tenant_id", tenantId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, doc_type: docType });
}
