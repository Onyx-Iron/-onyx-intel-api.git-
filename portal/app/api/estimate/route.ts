import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { getUserRole, redactFinancialFields } from "@/lib/project-controls/permissions";
import { ESTIMATE_FINANCIAL_FIELDS } from "@/lib/project-controls/financial-redaction";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { logEvent } from "@/lib/activity";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

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
      .from("estimate_items" as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: `[GET /api/estimate] ${error.message}` }, { status: 500 });

    // Financial-read gate (frontend-backend-reconciliation, item 4): a
    // restricted role (ClientView, Subcontractor, FieldSuperintendent) must
    // never receive cost/markup/profit values in the response body itself —
    // redacted here, server-side, before the JSON is ever sent, not just
    // hidden in the UI.
    const role = await getUserRole(tenantId, userId);
    const items = redactFinancialFields((data ?? []) as unknown as Record<string, unknown>[], role, ESTIMATE_FINANCIAL_FIELDS);

    return NextResponse.json({
      items,
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

    const body = await req.json() as {
      project_id: string;
      description: string;
      trade?: string | null;
      csi_code?: string | null;
      item_type?: string;
      quantity?: number | null;
      uom?: string | null;
      unit_cost?: number | null;
      notes?: string | null;
      source_takeoff_id?: string | null;
      source_fingerprint?: string | null;
      quantity_basis?: string | null;
      drawing_ref?: string | null;
      location_tag?: string | null;
      pricing_status?: string | null;
    };

    if (!body.description?.trim() || !body.project_id) {
      return NextResponse.json({ error: "description and project_id required" }, { status: 400 });
    }

    const pidParse = uuidSchema.safeParse(body.project_id);
    if (!pidParse.success) {
      return NextResponse.json({ error: "project_id must be a valid UUID" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("estimate_items" as any)
      .insert({
        tenant_id:   tenantId,
        project_id:  body.project_id,
        description: body.description.trim(),
        trade:       body.trade ?? null,
        csi_code:    body.csi_code ?? null,
        item_type:   body.item_type ?? "material",
        quantity:    body.quantity ?? null,
        uom:         body.uom ?? null,
        unit_cost:   body.unit_cost ?? null,
        notes:       body.notes ?? null,
        source_takeoff_id:  body.source_takeoff_id ?? null,
        source_fingerprint: body.source_fingerprint ?? null,
        quantity_basis:     body.quantity_basis ?? null,
        drawing_ref:        body.drawing_ref ?? null,
        location_tag:       body.location_tag ?? null,
        pricing_status:     body.pricing_status ?? "manual",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/estimate] ${error.message}` }, { status: 422 });

    void logEvent({
      projectId: pidParse.data,
      tenantId,
      userId,
      entityType: "estimate",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (data as any)?.id,
      action: "created",
      title: `Estimate item created: ${body.description.trim().slice(0, 100)}`,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
