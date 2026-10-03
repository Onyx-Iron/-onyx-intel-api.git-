import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { NoProviderError, availableProviders } from "@/lib/ai/providers";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { generateProjectStatusReport } from "@/lib/reports/project-status";

export const runtime = "nodejs";
export const maxDuration = 800;

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
    let result;
    try {
      result = await generateProjectStatusReport(tenantId, project_id);
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
      estimate_value: result.estimate_value,
      estimate_quality: result.estimate_quality,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/status-report] ${msg}` }, { status: 502 });
  }
}
