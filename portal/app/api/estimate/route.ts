import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { getUserRole, redactFinancialFields } from "@/lib/project-controls/permissions";
import { ESTIMATE_FINANCIAL_FIELDS } from "@/lib/project-controls/financial-redaction";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { listCurrentEstimateItems, listTenantCurrentEstimateItems } from "@/lib/estimating/current-version";

export const runtime = "nodejs";
const DEPRECATED_WRITE_MESSAGE =
  "Legacy estimate writes are disabled. Use /api/estimate/versions so every item belongs to the project's current estimate version.";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);
    const db = await createServiceClient();

    const allItems = projectId
      ? await listCurrentEstimateItems(db, tenantId, projectId)
      : await listTenantCurrentEstimateItems(db, tenantId);
    const data = allItems.slice(offset, offset + limit);

    // Financial-read gate (frontend-backend-reconciliation, item 4): a
    // restricted role (ClientView, Subcontractor, FieldSuperintendent) must
    // never receive cost/markup/profit values in the response body itself —
    // redacted here, server-side, before the JSON is ever sent, not just
    // hidden in the UI.
    const role = await getUserRole(tenantId, userId);
    const items = redactFinancialFields((data ?? []) as unknown as Record<string, unknown>[], role, ESTIMATE_FINANCIAL_FIELDS);

    return NextResponse.json({
      items,
      pagination: paginationMeta(allItems.length, page, limit),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: DEPRECATED_WRITE_MESSAGE }, { status: 410 });
}
