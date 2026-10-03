import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { getUserRole, redactFinancialFields } from "@/lib/project-controls/permissions";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditInsert } from "@/lib/audit";

export const runtime = "nodejs";

const CATALOG_FINANCIAL_FIELDS = ["unit_cost"] as const;

export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_catalog" as any)
      .select("*").eq("tenant_id", tenantId).order("csi_code", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const role = await getUserRole(tenantId, userId);
    const items = redactFinancialFields(
      (data ?? []) as unknown as Record<string, unknown>[],
      role,
      CATALOG_FINANCIAL_FIELDS,
    );
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
    if (!body.description) return NextResponse.json({ error: "description required" }, { status: 400 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    const db = await createServiceClient();
    const { data, error } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("cost_catalog" as any)
      .insert({
        tenant_id: tenantId,
        csi_code: body.csi_code ?? null,
        description: body.description,
        trade: body.trade ?? null,
        uom: body.uom ?? null,
        unit_cost: body.unit_cost ?? 0,
        category: body.category ?? null,
      })
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });

    auditInsert({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "cost_catalog",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record_id: (data as any).id,
      new_values: data as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
