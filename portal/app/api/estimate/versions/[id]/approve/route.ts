import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { buildEstimateApprovalPayload } from "@/lib/estimating/estimate-approval";
import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";
import { recordEstimateAudit } from "@/lib/estimating/audit";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

/**
 * POST /api/estimate/versions/[id]/approve
 *
 * Approves a draft/review version. Requires the "financial" write
 * permission (same gate as the takeoff-review approval endpoint) — this is
 * the "estimate approval permission" required by STEP 14. Only a
 * draft/review version can be approved; approving an already-approved,
 * superseded, or void version is rejected (there is nothing to transition).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { preview_id?: string };
  if (!body.preview_id) return NextResponse.json({ error: "preview_id is required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const db = await getServiceDb();
  let version;
  try {
    version = await loadVersionForTenant(db, id, tenantId);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }

  if (version.status !== "draft" && version.status !== "review") {
    return NextResponse.json({ error: `Version is '${version.status}' and cannot be approved.` }, { status: 409 });
  }

  const { data: preview } = await db.from("estimate_approval_previews").select("*")
    .eq("id", body.preview_id).eq("tenant_id", tenantId).eq("estimate_version_id", id)
    .eq("actor_user_id", userId).maybeSingle();
  if (!preview) return NextResponse.json({ error: "Estimate approval preview not found" }, { status: 404 });
  const { data: items, error: itemError } = await db.from("estimate_items").select("*")
    .eq("tenant_id", tenantId).eq("project_id", version.project_id).eq("estimate_version_id", id);
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  const currentPayload = buildEstimateApprovalPayload(version, items ?? []);
  if (!currentPayload.quality.ready_for_proposal) {
    return NextResponse.json({ error: "Estimate is no longer approval-ready", quality: currentPayload.quality }, { status: 409 });
  }
  const currentHash = hashApprovalPayload(currentPayload);
  if (currentHash !== preview.payload_hash) {
    return NextResponse.json({ error: "Estimate changed after approval preview" }, { status: 409 });
  }
  const { data: approved, error: approvalError } = await db.rpc("confirm_estimate_approval", {
    p_preview_id: body.preview_id,
    p_tenant_id: tenantId,
    p_actor_user_id: userId,
    p_payload_hash: currentHash,
  });
  if (approvalError) return NextResponse.json({ error: approvalError.message }, { status: 409 });

  await recordEstimateAudit(db, {
    tenantId, projectId: version.project_id, estimateId: version.estimate_id, estimateVersionId: id,
    entityType: "version", entityId: id, action: "approved", actorUserId: userId,
    before: { status: version.status }, after: { status: approved.status, approved_by: approved.approved_by, approved_at: approved.approved_at },
  });

  void logEvent({
    projectId: version.project_id, tenantId, userId,
    entityType: "estimate", entityId: id, action: "status_changed",
    title: `Estimate version ${version.version_number} approved`,
  });

  return NextResponse.json({ version: approved });
}
