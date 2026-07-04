import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * GET /api/agents/audit-trails?status=&project_id=&limit=
 *   Lists agent findings for the tenant, newest first. Filter by status
 *   (defaults to pending_human_review) and/or project.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const status    = req.nextUrl.searchParams.get("status") ?? "pending_human_review";
  const projectId = req.nextUrl.searchParams.get("project_id");
  const limit     = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50));

  let q = anyDb.from("ai_agent_audit_trails")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all")   q = q.eq("status", status);
  if (projectId)          q = q.eq("project_id", projectId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
