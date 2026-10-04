import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { canReadFinancial, getUserRole } from "@/lib/project-controls/permissions";
import { redactReportSummary } from "@/lib/project-controls/financial-redaction";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("report_runs")
      .select("id,project_id,report_type,title,status,provider,summary,inputs,body,generated_by,generated_at,created_at,projects(name)")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .single();

    if (error || !data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const showFinancial = canReadFinancial(await getUserRole(tenantId, userId));
    const report = showFinancial
      ? data
      : {
        ...data,
        body: null,
        summary: redactReportSummary(data.summary, false),
        inputs: data.inputs
          ? { ...data.inputs, estimate_value: null, estimate_quality: null }
          : data.inputs,
        financials_redacted: true,
      };
    return NextResponse.json({ report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/reports/[id]] ${msg}` }, { status: 500 });
  }
}
