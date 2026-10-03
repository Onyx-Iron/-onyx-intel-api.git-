import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { auditUpdate, auditDelete } from "@/lib/audit";

export const runtime = "nodejs";

const TABLE = "lien_waivers";
const ALLOWED = [
  "vendor_name", "waiver_type", "draw_number", "amount", "through_date",
  "state", "document_id", "signed_at", "signed_by", "status", "notes",
];

interface RouteContext { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const body = await req.json() as Record<string, unknown>;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    await assertProjectBelongsToTenant(projectId, tenantId);
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of ALLOWED) { if (k in body) updates[k] = body[k]; }

    const { data: before } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .maybeSingle();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[PATCH /api/lien-waivers/${id}] ${error.message}` }, { status: 422 });

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: TABLE,
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
      new_values: data as Record<string, unknown>,
    });

    return NextResponse.json({ item: data });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    await assertProjectBelongsToTenant(projectId, tenantId);
    const db = await createServiceClient();

    const { data: before } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .maybeSingle();

    const { error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId);

    if (error) return NextResponse.json({ error: `[DELETE /api/lien-waivers/${id}] ${error.message}` }, { status: 422 });

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: TABLE,
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
