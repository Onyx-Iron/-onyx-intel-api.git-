import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { auditInsert, auditUpdate } from "@/lib/audit";
import { hasPermission } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

/**
 * GET      → resolve or return the caller's company (1:1 with tenant)
 * PATCH    → { name?, subscription_status? }  update company fields
 */

async function ensureCompany(userId: string, orgId: string | null, orgSlug: string | null): Promise<{ tenantId: string; company: Record<string, unknown> }> {
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  let { data: company } = await anyDb.from("companies").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!company) {
    const name = authTenantName(userId, orgSlug) ?? "My Workspace";
    const { data: created } = await anyDb.from("companies").insert({ tenant_id: tenantId, name, subscription_status: "trial" }).select("*").single();
    company = created;
    if (company) {
      auditInsert({ tenant_id: tenantId, user_id: userId, table_name: "companies", record_id: String(company.id), new_values: company });
    }
  }
  return { tenantId, company };
}

export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { company } = await ensureCompany(userId, orgId ?? null, orgSlug ?? null);
  return NextResponse.json({ company });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { name?: string };
  const { tenantId, company } = await ensureCompany(userId, orgId ?? null, orgSlug ?? null);
  if (!(await hasPermission(tenantId, userId, "admin", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();

  const { data: updated, error } = await anyDb
    .from("companies")
    .update(patch)
    .eq("id", (company as { id: string }).id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  auditUpdate({
    tenant_id: tenantId,
    user_id: userId,
    table_name: "companies",
    record_id: String((company as { id: string }).id),
    old_values: company as Record<string, unknown>,
    new_values: updated,
  });
  return NextResponse.json({ company: updated });
}
