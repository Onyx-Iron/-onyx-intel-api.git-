import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { uuidSchema } from "@/lib/validation";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

const BUCKET = "daily-log-photos";

interface DailyLog {
  id: string; log_date: string; weather: string | null; temperature: string | null;
  crew_count: number | null; work_performed: string | null; notes: string | null;
  photo_urls: string[]; created_by: string | null; created_at: string;
}

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
      .from("daily_logs" as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: `[GET /api/daily-logs] ${error.message}` }, { status: 500 });

    // Re-sign every stored photo path so the client gets working URLs.
    const logs = (data ?? []) as unknown as DailyLog[];
    const out = await Promise.all(logs.map(async (log) => {
      const paths = Array.isArray(log.photo_urls) ? log.photo_urls : [];
      const photos = await Promise.all(paths.map(async (p) => {
        const { data: s } = await db.storage.from(BUCKET).createSignedUrl(p, 60 * 60 * 24 * 7);
        return { path: p, url: s?.signedUrl ?? null };
      }));
      return { ...log, photos };
    }));

    return NextResponse.json({
      logs: out,
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/daily-logs] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as Record<string, unknown>;
    if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const pidParse = uuidSchema.safeParse(body.project_id);
    if (!pidParse.success) {
      return NextResponse.json({ error: "project_id must be a valid UUID" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    await assertProjectBelongsToTenant(pidParse.data, tenantId);
    const db = await createServiceClient();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("daily_logs" as any)
      .insert({
        tenant_id:      tenantId,
        project_id:     pidParse.data,
        log_date:       body.log_date ?? new Date().toISOString().split("T")[0],
        weather:        body.weather ?? null,
        temperature:    body.temperature ?? null,
        crew_count:     body.crew_count ?? null,
        work_performed: body.work_performed ?? null,
        notes:          body.notes ?? null,
        photo_urls:     Array.isArray(body.photo_urls) ? body.photo_urls : [],
        created_by:     userId,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/daily-logs] ${error.message}` }, { status: 422 });

    void logEvent({
      projectId: pidParse.data,
      tenantId,
      userId,
      entityType: "daily_log",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any)?.id,
      action: "created",
      title: `Daily log created for ${String(body.log_date ?? new Date().toISOString().split("T")[0])}`,
    });

    return NextResponse.json({ log: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/daily-logs] ${msg}` }, { status: err instanceof PermissionError || msg.includes("does not belong") ? 403 : 500 });
  }
}
