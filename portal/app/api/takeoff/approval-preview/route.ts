import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";
import { assertPermission } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json() as { projectId?: string; jobId?: string; candidateIds?: unknown };
    const candidateIds = Array.isArray(body.candidateIds) ? [...new Set(body.candidateIds.filter((id): id is string => typeof id === "string"))].sort() : [];
    if (!body.projectId || !body.jobId || candidateIds.length === 0) return NextResponse.json({ error: "projectId, jobId, and candidateIds are required" }, { status: 400 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "write");
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: job } = await anyDb.from("takeoff_jobs").select("id,created_by,state").eq("id", body.jobId).eq("project_id", body.projectId).eq("tenant_id", tenantId).maybeSingle();
    if (!job) return NextResponse.json({ error: "Takeoff job not found" }, { status: 404 });
    if (job.state !== "review_ready") return NextResponse.json({ error: "Takeoff job is not ready for approval" }, { status: 409 });
    let { data: membership } = await anyDb.from("project_memberships").select("id,project_role").eq("tenant_id", tenantId).eq("project_id", body.projectId).eq("clerk_user_id", userId).eq("active", true).maybeSingle();
    if (!membership && job.created_by === userId) {
      const created = await anyDb.from("project_memberships").upsert({ tenant_id: tenantId, project_id: body.projectId, clerk_user_id: userId, project_role: "estimator", granted_by: userId }, { onConflict: "tenant_id,project_id,clerk_user_id" }).select("id,project_role").single();
      membership = created.data;
    }
    if (!membership || !["owner", "approver", "estimator"].includes(membership.project_role)) return NextResponse.json({ error: "Active project approval membership required" }, { status: 403 });

    const { data: candidates, error: candidateError } = await anyDb.from("takeoff_items")
      .select("id,row_version,quantity,unit,label,csi_code,document_id,sheet_id,page,takeoff_job_id,source_manifest_id,source_manifest_version,source_checksum,is_stale,review_status,quantity_validation_status,quantity_validation_reason,formula_version,calculation_checksum,source_provenance,meta")
      .eq("tenant_id", tenantId).eq("project_id", body.projectId).in("id", candidateIds);
    if (candidateError) throw candidateError;
    if (candidates.length !== candidateIds.length) return NextResponse.json({ error: "One or more candidates were not found" }, { status: 409 });
    if (candidates.some((candidate: Record<string, unknown>) => candidate.takeoff_job_id !== body.jobId || candidate.is_stale || !candidate.source_manifest_id || !candidate.source_manifest_version || !candidate.source_checksum || candidate.quantity_validation_status !== "validated")) {
      return NextResponse.json({ error: "Every candidate must be validated by this job against the current source revision" }, { status: 409 });
    }
    const manifestIds = [...new Set(candidates.map((candidate: Record<string, unknown>) => candidate.source_manifest_id as string))];
    const { data: manifests, error: manifestError } = await anyDb.from("takeoff_source_manifests")
      .select("id,authority_status,source_checksum,manifest_version").eq("tenant_id", tenantId).eq("project_id", body.projectId).in("id", manifestIds);
    if (manifestError) throw manifestError;
    if (manifests.length !== manifestIds.length || manifests.some((manifest: Record<string, unknown>) => manifest.authority_status !== "authoritative")) {
      return NextResponse.json({ error: "A selected candidate references a proposed or superseded drawing revision" }, { status: 409 });
    }
    const payload = {
      jobId: body.jobId,
      projectId: body.projectId,
      candidateVersions: candidates.map((candidate: Record<string, unknown>) => ({
        id: candidate.id, version: candidate.row_version, sourceManifestVersion: candidate.source_manifest_version,
        sourceChecksum: candidate.source_checksum, quantity: candidate.quantity, unit: candidate.unit,
        label: candidate.label, csiCode: candidate.csi_code, documentId: candidate.document_id,
        sheetId: candidate.sheet_id, page: candidate.page, formulaVersion: candidate.formula_version,
        calculationChecksum: candidate.calculation_checksum, sourceProvenance: candidate.source_provenance,
      })).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
      estimateEffect: { targetStatus: "draft", approvedVersionsMutable: false },
    };
    const payloadHash = hashApprovalPayload(payload);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data: preview, error } = await anyDb.from("takeoff_approval_previews").insert({
      tenant_id: tenantId, project_id: body.projectId, job_id: body.jobId, actor_user_id: userId,
      payload, payload_hash: payloadHash, expires_at: expiresAt,
    }).select("*").single();
    if (error) throw error;
    return NextResponse.json({ preview }, { status: 201 });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
