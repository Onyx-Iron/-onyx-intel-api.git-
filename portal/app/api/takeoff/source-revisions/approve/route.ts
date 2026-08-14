import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { assertPermission } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({})) as { candidateId?: string };
    if (!body.candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "write");
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: candidate } = await anyDb.from("takeoff_items")
      .select("id,project_id,takeoff_job_id,source_manifest_id,review_status")
      .eq("id", body.candidateId).eq("tenant_id", tenantId).maybeSingle();
    if (!candidate) return NextResponse.json({ error: "Takeoff candidate not found" }, { status: 404 });
    if (!["suggested", "reviewed"].includes(candidate.review_status)) return NextResponse.json({ error: "Only undecided candidates can propose a source revision" }, { status: 409 });

    const { data: job } = await anyDb.from("takeoff_jobs").select("created_by")
      .eq("id", candidate.takeoff_job_id).eq("tenant_id", tenantId).eq("project_id", candidate.project_id).maybeSingle();
    let { data: membership } = await anyDb.from("project_memberships").select("id,project_role")
      .eq("tenant_id", tenantId).eq("project_id", candidate.project_id).eq("clerk_user_id", userId).eq("active", true).maybeSingle();
    if (!membership && job?.created_by === userId) {
      const created = await anyDb.from("project_memberships").upsert({
        tenant_id: tenantId, project_id: candidate.project_id, clerk_user_id: userId,
        project_role: "estimator", granted_by: userId,
      }, { onConflict: "tenant_id,project_id,clerk_user_id" }).select("id,project_role").single();
      membership = created.data;
    }
    if (!membership || !["owner", "approver", "estimator"].includes(membership.project_role)) {
      return NextResponse.json({ error: "Active project approval membership required" }, { status: 403 });
    }

    const { data: lineage } = await anyDb.from("takeoff_source_lineage").select("id")
      .eq("tenant_id", tenantId).eq("project_id", candidate.project_id)
      .eq("successor_id", candidate.source_manifest_id).eq("status", "proposed").maybeSingle();
    if (!lineage) return NextResponse.json({ error: "No pending source revision exists for this candidate" }, { status: 409 });
    const { data, error } = await anyDb.rpc("approve_takeoff_source_revision", {
      p_tenant_id: tenantId,
      p_project_id: candidate.project_id,
      p_lineage_id: lineage.id,
      p_actor_user_id: userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ revision: data });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
