import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

const TABLE = "material_vendors";
const ALLOWED = ["name", "category", "contact_name", "contact_email", "contact_phone", "unit_price", "unit", "lead_time_days", "notes"];

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
    await assertPermission(tenantId, userId, "financial", "write");
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of ALLOWED) { if (k in body) updates[k] = body[k]; }

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[PATCH /api/material-vendors/${id}] ${error.message}` }, { status: 422 });
    return NextResponse.json({ item: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: err instanceof PermissionError ? 403 : 500 });
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
    await assertPermission(tenantId, userId, "financial", "write");
    const db = await createServiceClient();

    const { error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(TABLE as any)
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId);

    if (error) return NextResponse.json({ error: `[DELETE /api/material-vendors/${id}] ${error.message}` }, { status: 422 });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
