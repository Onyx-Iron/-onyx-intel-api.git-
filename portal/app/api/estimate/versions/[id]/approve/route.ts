import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { approveVersion, getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { recordEstimateAudit } from "@/lib/estimating/audit";
import { buildEstimateQualityReport } from "@/lib/estimating/estimate-qc";
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
 * Also rejects when estimate QC reports blockers (unpriced / review /
 * missing evidence) so money-impacting approvals cannot skip the gate.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

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

  const { data: items, error: itemsErr } = await db
    .from("estimate_items")
    .select("id,description,csi_code,trade,item_type,quantity,uom,unit_cost,source_takeoff_id,source_fingerprint,quantity_basis,drawing_ref,location_tag,pricing_status")
    .eq("estimate_version_id", id);
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  const qc = buildEstimateQualityReport(items ?? []);
  if (!qc.ready_for_proposal) {
    return NextResponse.json({
      error: "Estimate is not ready for approval",
      blockers: qc.blockers,
      quality: qc,
    }, { status: 422 });
  }

  const approved = await approveVersion(db, { versionId: id, estimateId: version.estimate_id, userId });

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
