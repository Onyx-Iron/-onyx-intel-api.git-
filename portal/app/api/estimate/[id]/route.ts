import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const project_id = req.nextUrl.searchParams.get("project_id");
    if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

    const body = await req.json() as Record<string, unknown>;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const allowed = [
      "trade", "csi_code", "description", "item_type", "quantity", "uom",
      "unit_cost", "notes", "sort_order", "source_takeoff_id",
      "source_fingerprint", "quantity_basis", "drawing_ref", "location_tag",
      "pricing_status",
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("estimate_items" as any)
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("project_id", project_id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[PUT /api/estimate/${id}] ${error.message}` }, { status: 422 });
    return NextResponse.json({ item: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const project_id = req.nextUrl.searchParams.get("project_id");
    if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from("estimate_items" as any).delete().eq("id", id).eq("tenant_id", tenantId).eq("project_id", project_id);
    if (error) return NextResponse.json({ error: `[DELETE /api/estimate/${id}] ${error.message}` }, { status: 422 });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
