import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  authTenantKey,
  authTenantName,
  getOrCreateTenant,
  requireProjectId,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { runDailyLogAssistant } from "@/lib/agents/dailyLogAssistant";

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
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;
    await assertProjectBelongsToTenant(projectId, tenantId);

    const result = await runDailyLogAssistant(tenantId, projectId, date);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("project_id") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
