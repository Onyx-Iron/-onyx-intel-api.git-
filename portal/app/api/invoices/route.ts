import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { assertPermission, getUserRole, PermissionError, redactFinancialFields } from "@/lib/project-controls/permissions";
import { INVOICE_FINANCIAL_FIELDS } from "@/lib/project-controls/financial-redaction";
import { auditInsert } from "@/lib/audit";
import { uuidSchema } from "@/lib/validation";
import { parsePagination, paginationMeta } from "@/lib/pagination";

export const runtime = "nodejs";

const TABLE = "invoices" as const;
const FIELDS = [
  "direction", "invoice_number", "vendor_or_customer", "description",
  "amount", "retainage", "invoice_date", "due_date", "paid_date",
  "status", "payment_method", "reference", "notes",
] as const;

const VALID_DIRECTIONS = new Set(["receivable", "payable"]);
const VALID_STATUSES = new Set(["open", "paid", "overdue", "disputed", "canceled"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // project_id is optional so the global Financials workspace can roll up
    // invoices across every project for the tenant; every project-scoped
    // caller still passes it explicitly.
    const projectId = req.nextUrl.searchParams.get("project_id");

    const direction = req.nextUrl.searchParams.get("direction");
    const status = req.nextUrl.searchParams.get("status");

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams);
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(TABLE as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId);
    if (projectId) q = q.eq("project_id", projectId);

    if (direction && VALID_DIRECTIONS.has(direction)) q = q.eq("direction", direction);
    if (status && status !== "all") {
      if (status === "open") q = q.in("status", ["open", "overdue"]);
      else if (status === "closed") q = q.in("status", ["paid", "canceled"]);
      else if (VALID_STATUSES.has(status)) q = q.eq("status", status);
    }

    const { data, error, count } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: `[GET /api/invoices] ${error.message}` }, { status: 500 });

    const role = await getUserRole(tenantId, userId);
    const items = redactFinancialFields((data ?? []) as unknown as Record<string, unknown>[], role, INVOICE_FINANCIAL_FIELDS);

    return NextResponse.json({ items, pagination: paginationMeta(count ?? 0, page, limit) });
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

    const direction = typeof body.direction === "string" ? body.direction : "receivable";
    if (!VALID_DIRECTIONS.has(direction)) {
      return NextResponse.json({ error: "direction must be 'receivable' or 'payable'" }, { status: 400 });
    }
    const vc = typeof body.vendor_or_customer === "string" ? body.vendor_or_customer.trim() : "";
    if (!vc) return NextResponse.json({ error: "vendor_or_customer is required" }, { status: 400 });

    const status = typeof body.status === "string" ? body.status : "open";
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
    insert.direction = direction;
    insert.vendor_or_customer = vc;
    insert.status = status;
    if (insert.amount == null) insert.amount = 0;

    const { data, error } = await db
      .from(TABLE)
      .insert(insert)
      .select()
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/invoices] ${error.message}` }, { status: 422 });

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
