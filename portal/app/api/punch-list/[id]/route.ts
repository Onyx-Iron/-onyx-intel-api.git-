import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate, auditDelete } from "@/lib/audit";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const body = await req.json() as Record<string, unknown>;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    const allowed = ["description", "location", "trade", "responsible", "priority", "status", "due_date", "sign_off", "completed_date", "notes"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of allowed) { if (k in body) updates[k] = body[k]; }

    // Auto-set completed_date when status becomes complete/approved
    if (body.status === "complete" || body.status === "approved") {
      if (!updates.completed_date) updates.completed_date = new Date().toISOString().split("T")[0];
    }

    const { data: before } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("punch_list_items" as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("punch_list_items" as any)
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[PUT /api/punch-list/${id}] ${error.message}` }, { status: 422 });

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "punch_list_items",
      record_id: id,
      old_values: (before ?? null) as unknown as Record<string, unknown> | null,
      new_values: data as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ item: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    const { data: before } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("punch_list_items" as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from("punch_list_items" as any).delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: `[DELETE /api/punch-list/${id}] ${error.message}` }, { status: 422 });

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "punch_list_items",
      record_id: id,
      old_values: (before ?? null) as unknown as Record<string, unknown> | null,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
