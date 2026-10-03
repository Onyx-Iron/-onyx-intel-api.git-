import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST { project_id? } — attach existing project, or create one named after the opportunity.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as { project_id?: string };
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: opp, error: oppErr } = await anyDb
    .from("bid_opportunities")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (oppErr) return NextResponse.json({ error: oppErr.message }, { status: 500 });
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let projectId = body.project_id ?? opp.project_id;
  if (projectId) {
    try {
      await assertProjectBelongsToTenant(projectId, tenantId);
    } catch (err) {
      const owned = ownershipDenied(err);
      if (owned) return owned;
      throw err;
    }
  } else {
    const { data: project, error: pErr } = await anyDb
      .from("projects")
      .insert({
        tenant_id: tenantId,
        name: opp.name,
        status: "bidding",
      })
      .select("id")
      .single();
    if (pErr || !project) {
      return NextResponse.json({ error: pErr?.message ?? "Could not create project" }, { status: 500 });
    }
    projectId = project.id;
  }

  const { data: updated, error } = await anyDb
    .from("bid_opportunities")
    .update({
      project_id: projectId,
      stage: opp.stage === "identified" ? "pursuing" : opp.stage,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void logEvent({
    projectId,
    tenantId,
    userId,
    entityType: "bid_opportunity",
    entityId: id,
    action: "updated",
    title: `Bid linked to project: ${opp.name}`,
    meta: { href: `/dashboard/projects/${projectId}` },
  });

  return NextResponse.json({ opportunity: updated, project_id: projectId });
}
