import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { canReadFinancial, getUserRole } from "@/lib/project-controls/permissions";
import { redactAuditSnapshot } from "@/lib/project-controls/financial-redaction";

export const runtime = "nodejs";

/**
 * GET /api/audit-logs?table=&record_id=&user_id=&limit=
 * Tenant-scoped read of the centralized audit log. Newest first.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const table    = req.nextUrl.searchParams.get("table");
  const recordId = req.nextUrl.searchParams.get("record_id");
  const user     = req.nextUrl.searchParams.get("user_id");
  const limit    = Math.min(500, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50));

  let q = anyDb.from("audit_logs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (table)    q = q.eq("table_name", table);
  if (recordId) q = q.eq("record_id", recordId);
  if (user)     q = q.eq("user_id", user);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const canRead = canReadFinancial(await getUserRole(tenantId, userId));
  const items = ((data ?? []) as Array<Record<string, unknown>>).map((row) => (
    canRead
      ? row
      : {
        ...row,
        old_values: redactAuditSnapshot(row.old_values, false),
        new_values: redactAuditSnapshot(row.new_values, false),
      }
  ));
  return NextResponse.json({ items });
}
