import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  authTenantKey,
  authTenantName,
  getOrCreateTenant,
  requireProjectId,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { runDailyLogAssistant } from "@/lib/agents/dailyLogAssistant";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      project_id?: unknown;
      date?: unknown;
    };
    const projectId = requireProjectId(body.project_id);
    const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : undefined;

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    await assertPermission(tenantId, userId, "field", "write");
    await assertProjectBelongsToTenant(projectId, tenantId);

    const result = await runDailyLogAssistant(tenantId, projectId, date);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof PermissionError || msg.includes("does not belong") ? 403 : msg.includes("project_id") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
