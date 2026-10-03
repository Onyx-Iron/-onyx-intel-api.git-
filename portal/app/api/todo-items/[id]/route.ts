import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate, auditDelete } from "@/lib/audit";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

const VALID_STATUS = new Set(["open", "in_progress", "done"]);
const VALID_PRIORITY = new Set(["low", "medium", "high", "critical"]);

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const body = await req.json() as Record<string, unknown>;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    const db = await createServiceClient();

    const allowed = ["title", "notes", "due_date", "status", "priority", "assignee", "completed_at"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of allowed) { if (k in body) updates[k] = body[k]; }

    if ("status" in updates) {
      if (typeof updates.status !== "string" || !VALID_STATUS.has(updates.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      // Auto-manage completed_at on status transition (unless explicit override)
      if (!("completed_at" in body)) {
        if (updates.status === "done") {
          updates.completed_at = new Date().toISOString();
        } else {
          updates.completed_at = null;
        }
      }
    }
    if ("priority" in updates && (typeof updates.priority !== "string" || !VALID_PRIORITY.has(updates.priority))) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    const { data: before } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("todo_items" as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("todo_items" as any)
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[PATCH /api/todo-items/${id}] ${error.message}` }, { status: 422 });

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "todo_items",
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
      .from("todo_items" as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from("todo_items" as any).delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: `[DELETE /api/todo-items/${id}] ${error.message}` }, { status: 422 });

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "todo_items",
      record_id: id,
      old_values: (before ?? null) as unknown as Record<string, unknown> | null,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
