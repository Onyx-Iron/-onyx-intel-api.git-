import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate, auditDelete } from "@/lib/audit";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

const STATUSES = new Set(["scheduled", "passed", "failed", "conditional", "canceled"]);
const INSPECTION_TYPES = new Set(["building", "fire", "health", "electrical", "plumbing", "mechanical", "elevator", "other"]);
const CERT_TYPES = new Set(["TCO", "CO"]);

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

    const allowed = [
      "inspection_type", "scheduled_date", "inspector_name", "inspector_phone", "inspector_email",
      "status", "result_date", "corrective_actions", "certificate_number", "certificate_issued_date",
      "certificate_type", "document_id", "notes",
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of allowed) { if (k in body) updates[k] = body[k]; }

    if ("status" in updates && updates.status !== null && !STATUSES.has(updates.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if ("inspection_type" in updates && updates.inspection_type !== null && !INSPECTION_TYPES.has(updates.inspection_type)) {
      return NextResponse.json({ error: "Invalid inspection_type" }, { status: 400 });
    }
    if ("certificate_type" in updates && updates.certificate_type !== null && updates.certificate_type !== undefined && !CERT_TYPES.has(updates.certificate_type)) {
      return NextResponse.json({ error: "certificate_type must be 'TCO' or 'CO'" }, { status: 400 });
    }

    const { data: before } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("co_inspections" as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("co_inspections" as any)
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[PATCH /api/co-inspections/${id}] ${error.message}` }, { status: 422 });

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "co_inspections",
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
      .from("co_inspections" as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("co_inspections" as any)
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: `[DELETE /api/co-inspections/${id}] ${error.message}` }, { status: 422 });

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "co_inspections",
      record_id: id,
      old_values: (before ?? null) as unknown as Record<string, unknown> | null,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
