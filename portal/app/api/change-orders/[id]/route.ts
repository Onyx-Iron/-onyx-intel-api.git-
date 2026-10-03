import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildChangeOrderUpdate } from "@/lib/project-controls/schema";
import {
  authTenantKey,
  authTenantName,
  getControlDb,
  getOrCreateTenant,
} from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate, auditDelete } from "@/lib/audit";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const updates = { ...buildChangeOrderUpdate(body), updated_at: new Date().toISOString() };
    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    const db = await getControlDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: before } = await (db as any)
      .from("change_order_items")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { data, error } = await db
      .from<unknown>("change_order_items")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: "Change Orders are not yet available in this workspace.", code: "FEATURE_UNAVAILABLE" }, { status: 503 });

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "change_order_items",
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
      new_values: data as Record<string, unknown>,
    });

    return NextResponse.json({ item: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    const db = await getControlDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: before } = await (db as any)
      .from("change_order_items")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { error } = await db
      .from<unknown>("change_order_items")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) return NextResponse.json({ error: "Change Orders are not yet available in this workspace.", code: "FEATURE_UNAVAILABLE" }, { status: 503 });

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "change_order_items",
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
