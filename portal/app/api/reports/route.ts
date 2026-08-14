import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { NoProviderError, availableProviders } from "@/lib/ai/providers";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { generateProjectStatusReport } from "@/lib/reports/project-status";
import { createServiceClient } from "@/lib/supabase/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const VALID_TYPES = new Set(["project_status"]);

function reportTitle(projectName: string, requested?: string): string {
  const clean = requested?.trim();
  if (clean) return clean.slice(0, 140);
  return `${projectName} Status Report - ${new Date().toLocaleDateString("en-US")}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "read");
    const projectId = req.nextUrl.searchParams.get("project_id");
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams, 50);
    const db = await createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (db as any)
      .from("report_runs")
      .select("id,project_id,report_type,title,status,provider,summary,generated_by,generated_at,created_at,projects(name)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("generated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (projectId) query = query.eq("project_id", projectId);
    const { data, error, count } = await query;
    if (error) return NextResponse.json({ error: `[GET /api/reports] ${error.message}` }, { status: 500 });

    return NextResponse.json({
      reports: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/reports] ${msg}` }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as { project_id?: string; report_type?: string; title?: string };
    const projectId = body.project_id?.trim();
    const reportType = body.report_type?.trim() || "project_status";
    if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });
    if (!VALID_TYPES.has(reportType)) return NextResponse.json({ error: "Unsupported report_type" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "read");
    const db = await createServiceClient();

    const rl = await checkAiRateLimit(tenantId, "reports/generate", { windowMs: 60_000, max: 5 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many report generation requests — please slow down." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    let generated;
    try {
      generated = await generateProjectStatusReport(tenantId, projectId);
    } catch (e) {
      if (e instanceof NoProviderError) {
        return NextResponse.json({ error: e.message, code: "NO_PROVIDER", available: availableProviders() }, { status: 503 });
      }
      if (e instanceof Error && e.message === "Project not found") {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      throw e;
    }

    const payload = {
      tenant_id: tenantId,
      project_id: projectId,
      report_type: reportType,
      title: reportTitle(generated.project.name, body.title),
      status: "generated",
      provider: generated.provider,
      body: generated.report,
      summary: {
        project_name: generated.project.name,
        completion: generated.completion,
        estimate_value: generated.estimate_value,
        estimate_ready: generated.estimate_quality.ready_for_proposal,
        risk_score: generated.estimate_quality.risk_score,
      },
      inputs: {
        completion: generated.completion,
        estimate_value: generated.estimate_value,
        estimate_quality: generated.estimate_quality,
      },
      generated_by: userId,
      generated_at: new Date().toISOString(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("report_runs")
      .insert(payload)
      .select("id,project_id,report_type,title,status,provider,summary,body,generated_by,generated_at,created_at")
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/reports] ${error.message}` }, { status: 500 });
    return NextResponse.json({ report: data }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/reports] ${msg}` }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
