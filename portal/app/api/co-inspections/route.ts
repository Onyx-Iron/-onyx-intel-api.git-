import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

const INSPECTION_TYPES = new Set(["building", "fire", "health", "electrical", "plumbing", "mechanical", "elevator", "other"]);
const STATUSES = new Set(["scheduled", "passed", "failed", "conditional", "canceled"]);
const CERT_TYPES = new Set(["TCO", "CO"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);
    const db = await createServiceClient();

    const { data, error, count } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("co_inspections" as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: `[GET /api/co-inspections] ${error.message}` }, { status: 500 });
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

    const projectIdResult = uuidSchema.safeParse(body.project_id);
    if (!projectIdResult.success) {
      return NextResponse.json({ error: "project_id: Invalid UUID" }, { status: 400 });
    }
    const insType = typeof body.inspection_type === "string" ? body.inspection_type.trim().toLowerCase() : "";
    if (!insType || !INSPECTION_TYPES.has(insType)) {
      return NextResponse.json({ error: "inspection_type is required (building/fire/health/electrical/plumbing/mechanical/elevator/other)" }, { status: 400 });
    }
    const status = typeof body.status === "string" ? body.status : "scheduled";
    if (!STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const certType = body.certificate_type;
    if (certType !== null && certType !== undefined && (typeof certType !== "string" || !CERT_TYPES.has(certType))) {
      return NextResponse.json({ error: "certificate_type must be 'TCO' or 'CO'" }, { status: 400 });
    }

    const projectId = projectIdResult.data;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("co_inspections" as any)
      .insert({
        tenant_id:                tenantId,
        project_id:               projectId,
        inspection_type:          insType,
        scheduled_date:           body.scheduled_date ?? null,
        inspector_name:           body.inspector_name ?? null,
        inspector_phone:          body.inspector_phone ?? null,
        inspector_email:          body.inspector_email ?? null,
        status,
        result_date:              body.result_date ?? null,
        corrective_actions:       body.corrective_actions ?? null,
        certificate_number:       body.certificate_number ?? null,
        certificate_issued_date:  body.certificate_issued_date ?? null,
        certificate_type:         certType ?? null,
        document_id:              body.document_id ?? null,
        notes:                    body.notes ?? null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/co-inspections] ${error.message}` }, { status: 422 });

    void logEvent({
      projectId,
      tenantId,
      userId,
      entityType: "co_inspection",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any).id,
      action: "created",
      title: `CO inspection scheduled: ${insType}`,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
