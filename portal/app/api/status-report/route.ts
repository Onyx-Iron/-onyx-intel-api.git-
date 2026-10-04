import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { NoProviderError, availableProviders } from "@/lib/ai/providers";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { generateProjectStatusReport } from "@/lib/reports/project-status";
import { canReadFinancial, getUserRole } from "@/lib/project-controls/permissions";
import { redactEstimateQuality } from "@/lib/project-controls/financial-redaction";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Backward-compatible one-shot status report endpoint. The Reports workspace
 * uses /api/reports to persist the same generated output in report_runs.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { project_id } = await req.json() as { project_id?: string };
    if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    try {
      await assertProjectBelongsToTenant(project_id, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }
    const showFinancial = canReadFinancial(await getUserRole(tenantId, userId));
    let result;
    try {
      result = await generateProjectStatusReport(tenantId, project_id, { includeFinancials: showFinancial });
    } catch (e) {
      if (e instanceof NoProviderError) {
        return NextResponse.json({ error: e.message, code: "NO_PROVIDER", available: availableProviders() }, { status: 503 });
      }
      if (e instanceof Error && e.message === "Project not found") {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      throw e;
    }

    return NextResponse.json({
      report: result.report,
      provider: result.provider,
      completion: result.completion,
      estimate_value: showFinancial ? result.estimate_value : null,
      estimate_quality: showFinancial ? result.estimate_quality : redactEstimateQuality(result.estimate_quality),
      financials_redacted: !showFinancial,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/status-report] ${msg}` }, { status: 502 });
  }
}
