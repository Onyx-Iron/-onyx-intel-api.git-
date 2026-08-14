import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { recordEstimateAudit } from "@/lib/estimating/audit";
import { resolveApprovedPriceApplication, type ApprovedPriceObservation } from "@/lib/estimating/price-application";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { hashApprovalPayload } from "@/lib/takeoff/approval-preview";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    item_id?: string;
    price_observation_id?: string;
    confirm?: boolean;
    preview_hash?: string;
  };
  if (!body.item_id || !body.price_observation_id) {
    return NextResponse.json({ error: "item_id and price_observation_id are required" }, { status: 400 });
  }
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
    return NextResponse.json({ error: "Only a draft or review estimate may be priced" }, { status: 409 });
  }
  const { data: item } = await db.from("estimate_items").select("*")
    .eq("id", body.item_id).eq("estimate_version_id", id).eq("tenant_id", tenantId)
    .eq("project_id", version.project_id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Estimate item not found in this version" }, { status: 404 });
  const { data: observation } = await db.from("price_observations").select("*")
    .eq("id", body.price_observation_id).eq("tenant_id", tenantId)
    .or(`project_id.eq.${version.project_id},project_id.is.null`).maybeSingle();
  if (!observation) return NextResponse.json({ error: "Price observation not found for this project" }, { status: 404 });

  const application = resolveApprovedPriceApplication({
    projectId: version.project_id,
    costCode: item.cost_code ?? item.csi_code ?? null,
    quantity: Number(item.quantity),
    unit: item.uom ?? "",
    percentages: {
      contingencyPct: version.contingency_pct,
      overheadPct: version.overhead_pct,
      profitPct: version.profit_pct,
    },
    asOfDate: new Date().toISOString().slice(0, 10),
  }, observation as ApprovedPriceObservation);
  if (!application.valid) return NextResponse.json({ error: `Price evidence cannot be applied: ${application.reason}` }, { status: 409 });

  const previewPayload = {
    action: "apply_approved_price",
    projectId: version.project_id,
    estimateVersionId: id,
    versionRevision: version.row_version,
    itemId: item.id,
    priceObservationId: observation.id,
    sourceKind: observation.source_kind,
    sourceRef: observation.source_ref,
    effectiveDate: observation.effective_date,
    before: {
      quantity: item.quantity, unit: item.uom, totalDirectCost: item.total_direct_cost,
      totalPrice: item.total_price, priceObservationId: item.price_observation_id,
    },
    after: application.patch,
  };
  const previewHash = hashApprovalPayload(previewPayload);
  if (!body.confirm) return NextResponse.json({ preview: previewPayload, preview_hash: previewHash });
  if (!body.preview_hash || body.preview_hash !== previewHash) {
    return NextResponse.json({ error: "Estimate or price evidence changed after preview" }, { status: 409 });
  }

  const { data: updated, error: updateError } = await db.from("estimate_items")
    .update({ ...application.patch, row_version: Number(item.row_version ?? 0) + 1, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", item.id).eq("estimate_version_id", id).eq("tenant_id", tenantId)
    .eq("row_version", Number(item.row_version ?? 0)).select("*").maybeSingle();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 422 });
  if (!updated) return NextResponse.json({ error: "Estimate item changed while price confirmation was open" }, { status: 409 });
  await recordEstimateAudit(db, {
    tenantId, projectId: version.project_id, estimateId: version.estimate_id, estimateVersionId: id,
    entityType: "item", entityId: item.id, action: "updated", actorUserId: userId, before: item, after: updated,
  });
  return NextResponse.json({ item: updated, preview_hash: previewHash });
}
