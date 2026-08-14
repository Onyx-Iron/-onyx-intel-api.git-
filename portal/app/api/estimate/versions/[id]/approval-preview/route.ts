import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { buildEstimateApprovalPayload } from "@/lib/estimating/estimate-approval";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (error) {
    if (error instanceof PermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const db = await getServiceDb();
  let version;
  try {
    version = await loadVersionForTenant(db, id, tenantId);
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
  if (version.status !== "draft" && version.status !== "review") {
    return NextResponse.json({ error: `Version is '${version.status}' and cannot be approved.` }, { status: 409 });
  }

  let { data: membership } = await db.from("project_memberships")
    .select("id,project_role").eq("tenant_id", tenantId).eq("project_id", version.project_id)
    .eq("clerk_user_id", userId).eq("active", true).maybeSingle();
  if (!membership && version.created_by === userId) {
    const created = await db.from("project_memberships").upsert({
      tenant_id: tenantId, project_id: version.project_id, clerk_user_id: userId,
      project_role: "estimator", granted_by: userId,
    }, { onConflict: "tenant_id,project_id,clerk_user_id" }).select("id,project_role").single();
    membership = created.data;
  }
  if (!membership || !["owner", "approver", "estimator"].includes(membership.project_role)) {
    return NextResponse.json({ error: "Active project estimate-approval membership required" }, { status: 403 });
  }

  const { data: items, error: itemError } = await db.from("estimate_items")
    .select("*").eq("tenant_id", tenantId).eq("project_id", version.project_id)
    .eq("estimate_version_id", id).order("sort_order", { ascending: true });
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  const payload = buildEstimateApprovalPayload(version, items ?? []);
  if (!payload.quality.ready_for_proposal) {
    return NextResponse.json({ error: "Estimate is not approval-ready", quality: payload.quality }, { status: 409 });
  }

  const payloadHash = hashApprovalPayload(payload);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { data: preview, error } = await db.from("estimate_approval_previews").insert({
    tenant_id: tenantId, project_id: version.project_id, estimate_id: version.estimate_id,
    estimate_version_id: id, actor_user_id: userId, payload, payload_hash: payloadHash,
    expires_at: expiresAt,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ preview }, { status: 201 });
}
