import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildRfiPayload } from "@/lib/project-controls/schema";
import {
  assertProjectBelongsToTenant,
  authTenantKey,
  authTenantName,
  getControlDb,
  getOrCreateTenant,
  requireProjectId,
} from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { auditInsert } from "@/lib/audit";
import { rfiCreateSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";

const UNAVAILABLE = { error: "RFIs are not yet available in this workspace.", code: "FEATURE_UNAVAILABLE" };

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = requireProjectId(req.nextUrl.searchParams.get("project_id"));
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);
    const db = await getControlDb();

    const { data, error, count } = await db
      .from<unknown[]>("rfi_items")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ items: [] });
    return NextResponse.json({
      items: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("project_id") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parseBody(rfiCreateSchema, body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const projectId = requireProjectId(body.project_id);
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertProjectBelongsToTenant(projectId, tenantId);
    const payload = buildRfiPayload(body, { tenantId, projectId });
    const db = await getControlDb();

    const { data, error } = await db
      .from<unknown>("rfi_items")
      .insert(payload)
      .select()
      .single();

    if (error) return NextResponse.json({ ...UNAVAILABLE }, { status: 503 });

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "rfi_items",
      record_id: (data as any).id,
      new_values: data as Record<string, unknown>,
    });
    void logEvent({
      projectId,
      tenantId,
      userId,
      entityType: "rfi",
      entityId: (data as any).id,
      action: "created",
      title: `RFI created: ${parsed.data.title}`,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("required") ? 400 : msg.includes("does not belong") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
