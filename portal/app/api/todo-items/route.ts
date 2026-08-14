import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { uuidSchema } from "@/lib/validation";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

const VALID_STATUS = new Set(["open", "in_progress", "done"]);
const VALID_PRIORITY = new Set(["low", "medium", "high", "critical"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const statusFilter = req.nextUrl.searchParams.get("status");

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertProjectBelongsToTenant(projectId, tenantId);
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);
    const db = await createServiceClient();

    let query = db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("todo_items" as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId);

    if (statusFilter && VALID_STATUS.has(statusFilter)) {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query
      .order("status", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: `[GET /api/todo-items] ${error.message}` }, { status: 500 });
    return NextResponse.json({
      items: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as Record<string, unknown>;

    const pidParse = uuidSchema.safeParse(body.project_id);
    if (!pidParse.success) {
      return NextResponse.json({ error: "project_id: Invalid UUID" }, { status: 400 });
    }
    if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const status = typeof body.status === "string" && VALID_STATUS.has(body.status) ? body.status : "open";
    const priority = typeof body.priority === "string" && VALID_PRIORITY.has(body.priority) ? body.priority : "medium";

    const projectId = pidParse.data;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    await assertProjectBelongsToTenant(projectId, tenantId);
    const db = await createServiceClient();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("todo_items" as any)
      .insert({
        tenant_id:    tenantId,
        project_id:   projectId,
        title:        body.title.trim(),
        notes:        body.notes ?? null,
        due_date:     body.due_date ?? null,
        status,
        priority,
        assignee:     body.assignee ?? null,
        completed_at: status === "done" ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/todo-items] ${error.message}` }, { status: 422 });

    void logEvent({
      projectId,
      tenantId,
      userId,
      entityType: "todo_item",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any).id,
      action: "created",
      title: `To-do created: ${String(body.title).slice(0, 100)}`,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = String(err);
    return NextResponse.json({ error: msg }, { status: err instanceof PermissionError || msg.includes("does not belong") ? 403 : 500 });
  }
}
