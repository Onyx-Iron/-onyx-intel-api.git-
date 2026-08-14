import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { scheduleTaskCreateSchema, parseBody } from "@/lib/validation";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertProjectBelongsToTenant(projectId, tenantId);
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);

    const db = await createServiceClient();
    const { data, error, count } = await db
      .from("schedule_tasks")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: `[GET /api/schedule] ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      tasks: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/schedule] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await req.json();
    const parsed = parseBody(scheduleTaskCreateSchema, rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { project_id, name, status, start_date, end_date, duration, critical } = parsed.data;

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    await assertProjectBelongsToTenant(project_id, tenantId);

    const db = await createServiceClient();
    const { data, error } = await db
      .from("schedule_tasks")
      .insert({
        tenant_id: tenantId,
        project_id,
        name: name.trim(),
        status: status ?? undefined,
        start_date: start_date ?? undefined,
        end_date: end_date ?? undefined,
        duration: duration ?? undefined,
        critical: critical ?? undefined,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: `[POST /api/schedule] ${error.message}` }, { status: 422 });
    }

    void logEvent({
      projectId: project_id,
      tenantId,
      userId,
      entityType: "schedule",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any).id,
      action: "created",
      title: `Schedule task created: ${name.trim()}`,
    });

    return NextResponse.json({ task: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/schedule] ${msg}` }, { status: err instanceof PermissionError || msg.includes("does not belong") ? 403 : 500 });
  }
}
