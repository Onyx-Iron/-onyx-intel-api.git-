import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { assertPermission, getUserRole, PermissionError, redactFinancialFields } from "@/lib/project-controls/permissions";
import { auditInsert } from "@/lib/audit";
import { uuidSchema } from "@/lib/validation";

// lien_waivers.amount is financial data -- closes the same gap documented
// as remaining scope in docs/frontend-backend-reconciliation/ROLE_VISIBILITY_MATRIX.md
// (item 4), now that this workspace surfaces it to restricted roles too.
const LIEN_WAIVER_FINANCIAL_FIELDS = ["amount"] as const;

export const runtime = "nodejs";

const TABLE = "lien_waivers" as const;
const FIELDS = [
  "vendor_name", "waiver_type", "draw_number", "amount", "through_date",
  "state", "document_id", "signed_at", "signed_by", "status", "notes",
] as const;

const VALID_STATUSES = new Set(["pending", "received", "expired"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // project_id is optional so the global Financials workspace can roll up
    // lien waivers across every project for the tenant; every project-scoped
    // caller still passes it explicitly.
    const projectId = req.nextUrl.searchParams.get("project_id");
    const status = req.nextUrl.searchParams.get("status");

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(TABLE as any)
      .select("*")
      .eq("tenant_id", tenantId);
    if (projectId) q = q.eq("project_id", projectId);
    if (status && VALID_STATUSES.has(status)) q = q.eq("status", status);

    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: `[GET /api/lien-waivers] ${error.message}` }, { status: 500 });

    const role = await getUserRole(tenantId, userId);
    const items = redactFinancialFields((data ?? []) as Record<string, unknown>[], role, LIEN_WAIVER_FINANCIAL_FIELDS);
    return NextResponse.json({ items });
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
    if (!projectIdResult.success) return NextResponse.json({ error: "project_id: Invalid UUID" }, { status: 400 });

    const vendor = typeof body.vendor_name === "string" ? body.vendor_name.trim() : "";
    if (!vendor) return NextResponse.json({ error: "vendor_name is required" }, { status: 400 });

    const waiver = typeof body.waiver_type === "string" && body.waiver_type.trim() ? body.waiver_type.trim() : "conditional_progress";
    const status = typeof body.status === "string" ? body.status : "pending";
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `status must be one of ${[...VALID_STATUSES].join(", ")}` }, { status: 400 });
    }

    const projectId = projectIdResult.data;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "write");
    await assertProjectBelongsToTenant(projectId, tenantId);
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insert: Record<string, any> = { tenant_id: tenantId, project_id: projectId };
    for (const k of FIELDS) insert[k] = body[k] ?? null;
    insert.vendor_name = vendor;
    insert.waiver_type = waiver;
    insert.status = status;

    const { data, error } = await db
      .from(TABLE)
      .insert(insert)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/lien-waivers] ${error.message}` }, { status: 422 });

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: TABLE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record_id: (data as any).id,
      new_values: data as Record<string, unknown>,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = String(err);
    return NextResponse.json({ error: msg }, { status: err instanceof PermissionError || msg.includes("does not belong") ? 403 : 500 });
  }
}
