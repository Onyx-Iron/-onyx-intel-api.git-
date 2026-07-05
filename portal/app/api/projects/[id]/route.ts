import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { uuidSchema } from "@/lib/validation";
import { logEvent } from "@/lib/activity";
import { auditUpdate, auditDelete } from "@/lib/audit";

export const runtime = "nodejs";

async function resolveTenant() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return { error: "Unauthorized", status: 401 } as const;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  return { userId, tenantId } as const;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await resolveTenant();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { id } = await params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    const db = await createServiceClient();
    const { data, error } = await db
      .from("projects")
      .select("*")
      .eq("id", parsed.data)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (error || !data) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ project: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/projects/:id] ${msg}` }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await resolveTenant();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { id } = await params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const allowed = ["name", "address", "city", "state", "zip_code", "latitude", "longitude", "status", "budget", "start_date", "end_date", "meta"] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }

    const db = await createServiceClient();
    // Snapshot old values for the audit log before mutation
    const { data: before } = await db
      .from("projects").select("*")
      .eq("id", parsed.data).eq("tenant_id", ctx.tenantId).single();

    const { data, error } = await db
      .from("projects")
      .update(patch as never)
      .eq("id", parsed.data)
      .eq("tenant_id", ctx.tenantId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    auditUpdate({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      table_name: "projects",
      record_id: parsed.data,
      old_values: (before ?? null) as Record<string, unknown> | null,
      new_values: data as Record<string, unknown>,
    });
    void logEvent({
      projectId: parsed.data,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: "project",
      entityId: parsed.data,
      action: "updated",
      title: "Project updated",
      meta: patch,
    });

    return NextResponse.json({ project: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[PATCH /api/projects/:id] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await resolveTenant();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { id } = await params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    const db = await createServiceClient();
    // Full row snapshot so the audit log carries the deleted state
    const { data: existing } = await db
      .from("projects")
      .select("*")
      .eq("id", parsed.data)
      .eq("tenant_id", ctx.tenantId)
      .single();
    if (!existing) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { error } = await db
      .from("projects")
      .delete()
      .eq("id", parsed.data)
      .eq("tenant_id", ctx.tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    auditDelete({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      table_name: "projects",
      record_id: parsed.data,
      old_values: existing as Record<string, unknown>,
    });
    void logEvent({
      projectId: parsed.data,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: "project",
      entityId: parsed.data,
      action: "deleted",
      title: `Project deleted: ${existing.name ?? parsed.data}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/projects/:id] ${msg}` }, { status: 500 });
  }
}
