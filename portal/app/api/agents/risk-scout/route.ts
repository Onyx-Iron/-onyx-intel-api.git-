import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  authTenantKey,
  authTenantName,
  getOrCreateTenant,
  requireProjectId,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { getLastRiskScoutFindings, runRiskScout } from "@/lib/agents/riskScout";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { project_id?: unknown };
    const projectId = requireProjectId(body.project_id);
    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    await assertPermission(tenantId, userId, "financial", "read");
    await assertProjectBelongsToTenant(projectId, tenantId);

    const result = await runRiskScout(tenantId, projectId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof PermissionError || msg.includes("does not belong") ? 403 : msg.includes("project_id") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = requireProjectId(req.nextUrl.searchParams.get("project_id"));
    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    await assertPermission(tenantId, userId, "financial", "read");
    await assertProjectBelongsToTenant(projectId, tenantId);

    const last = await getLastRiskScoutFindings(tenantId, projectId);
    return NextResponse.json(last ?? { run_id: null, findings: [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof PermissionError || msg.includes("does not belong") ? 403 : msg.includes("project_id") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
