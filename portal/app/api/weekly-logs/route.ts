import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { uuidSchema } from "@/lib/validation";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertProjectBelongsToTenant(projectId, tenantId);
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);
    const db = await createServiceClient();

    const { data, error, count } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("weekly_logs" as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("week_start", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: `[GET /api/weekly-logs] ${error.message}` }, { status: 500 });
    return NextResponse.json({
      logs: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/weekly-logs] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as Record<string, unknown>;
    const pidParse = uuidSchema.safeParse(body.project_id);
    if (!pidParse.success) {
      return NextResponse.json({ error: "project_id must be a valid UUID" }, { status: 400 });
    }
    if (!body.week_start || typeof body.week_start !== "string") {
      return NextResponse.json({ error: "week_start required (YYYY-MM-DD)" }, { status: 400 });
    }
    if (!body.week_end || typeof body.week_end !== "string") {
      return NextResponse.json({ error: "week_end required (YYYY-MM-DD)" }, { status: 400 });
    }

    const projectId = pidParse.data;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    await assertProjectBelongsToTenant(projectId, tenantId);
    const db = await createServiceClient();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("weekly_logs" as any)
      .insert({
        tenant_id:           tenantId,
        project_id:          projectId,
        week_start:          body.week_start,
        week_end:            body.week_end,
        schedule_status:     body.schedule_status ?? null,
        budget_status:       body.budget_status ?? null,
        milestones_completed: body.milestones_completed ?? null,
        upcoming_milestones: body.upcoming_milestones ?? null,
        open_issues:         body.open_issues ?? null,
        decisions_needed:    body.decisions_needed ?? null,
        summary:             body.summary ?? null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/weekly-logs] ${error.message}` }, { status: 422 });

    void logEvent({
      projectId,
      tenantId,
      userId,
      entityType: "weekly_log",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any)?.id,
      action: "created",
      title: `Weekly log created for week of ${String(body.week_start)}`,
    });

    return NextResponse.json({ log: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/weekly-logs] ${msg}` }, { status: err instanceof PermissionError || msg.includes("does not belong") ? 403 : 500 });
  }
}
