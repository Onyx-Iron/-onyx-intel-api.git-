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
      .from("punch_list_items" as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("item_number", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: `[GET /api/punch-list] ${error.message}` }, { status: 500 });
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

    // Validate project_id is a UUID and description is a non-empty string
    const projectIdResult = uuidSchema.safeParse(body.project_id);
    if (!projectIdResult.success) {
      return NextResponse.json({ error: "project_id: Invalid UUID" }, { status: 400 });
    }
    if (!body.description || typeof body.description !== "string" || body.description.trim().length === 0) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }

    const projectId = projectIdResult.data;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    await assertProjectBelongsToTenant(projectId, tenantId);
    const db = await createServiceClient();

    // Auto-assign item_number
    const { count } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("punch_list_items" as any)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId);

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("punch_list_items" as any)
      .insert({
        tenant_id:   tenantId,
        project_id:  projectId,
        item_number: (count ?? 0) + 1,
        description: body.description,
        location:    body.location ?? null,
        trade:       body.trade ?? null,
        responsible: body.responsible ?? null,
        priority:    body.priority ?? "medium",
        status:      body.status ?? "open",
        due_date:    body.due_date ?? null,
        sign_off:    body.sign_off ?? null,
        notes:       body.notes ?? null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/punch-list] ${error.message}` }, { status: 422 });

    void logEvent({
      projectId,
      tenantId,
      userId,
      entityType: "punch_list",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any).id,
      action: "created",
      title: `Punch list item created: ${String(body.description).slice(0, 100)}`,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = String(err);
    return NextResponse.json({ error: msg }, { status: err instanceof PermissionError || msg.includes("does not belong") ? 403 : 500 });
  }
}
