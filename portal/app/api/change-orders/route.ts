import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildChangeOrderPayload } from "@/lib/project-controls/schema";
import {
  assertProjectBelongsToTenant,
  authTenantKey,
  authTenantName,
  getControlDb,
  getOrCreateTenant,
  requireProjectId,
} from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { getUserRole, redactFinancialFields } from "@/lib/project-controls/permissions";
import { CHANGE_ORDER_FINANCIAL_FIELDS } from "@/lib/project-controls/financial-redaction";
import { logEvent } from "@/lib/activity";
import { auditInsert } from "@/lib/audit";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

const UNAVAILABLE = { error: "Change Orders are not yet available in this workspace.", code: "FEATURE_UNAVAILABLE" };

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = requireProjectId(req.nextUrl.searchParams.get("project_id"));
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);
    const db = await getControlDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error, count } = await (db as any)
      .from("change_order_items")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ items: [], pagination: paginationMeta(0, page, limit) });

    const role = await getUserRole(tenantId, userId);
    const items = redactFinancialFields((data ?? []) as Record<string, unknown>[], role, CHANGE_ORDER_FINANCIAL_FIELDS);

    return NextResponse.json({
      items,
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
    const projectId = requireProjectId(body.project_id);

    const pidParse = uuidSchema.safeParse(body.project_id);
    if (!pidParse.success) {
      return NextResponse.json({ error: "project_id must be a valid UUID" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertProjectBelongsToTenant(projectId, tenantId);
    const payload = buildChangeOrderPayload(body, { tenantId, projectId });
    const db = await getControlDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("change_order_items")
      .insert(payload)
      .select()
      .single();

    if (error) return NextResponse.json({ ...UNAVAILABLE }, { status: 503 });

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "change_order_items",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record_id: (data as any)?.id,
      new_values: data as Record<string, unknown>,
    });
    void logEvent({
      projectId: pidParse.data,
      tenantId,
      userId,
      entityType: "change_order",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any)?.id,
      action: "created",
      title: `Change order created: ${String(body.title ?? "").slice(0, 100)}`,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("required") ? 400 : msg.includes("does not belong") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
