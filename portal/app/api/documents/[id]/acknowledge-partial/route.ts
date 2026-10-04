import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

/** User confirms they saw the missing-page list and may measure the pages that did parse. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const db = await createServiceClient();
  const { data: doc, error } = await db
    .from("documents")
    .select("id, project_id, meta, status")
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
  if (doc.status !== "complete_with_errors") {
    return NextResponse.json({ error: "Only a partial document can be acknowledged." }, { status: 409 });
  }
  const meta = (doc.meta && typeof doc.meta === "object") ? doc.meta as Record<string, unknown> : {};
  const { error: updErr } = await db.from("documents").update({
    meta: { ...meta, partial_acknowledged: true },
  }).eq("id", id).eq("tenant_id", tenantId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
