import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { ownershipDenied } from "@/lib/project-controls/route-guards";
import { quantitiesAllowedForDocType, type ProcessingDocument } from "@/lib/documents/processing-display";
import { estimateReadiness } from "@/lib/estimating/readiness";
import { isSourceRemoved } from "@/lib/estimating/estimate-export";

export const runtime = "nodejs";

/** Why a priced estimate is or is not ready. Read-only. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: projectId } = await ctx.params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
  } catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  const { data: documents, error: docErr } = await db
    .from("documents")
    .select("id, status, doc_type, page_count, last_error, last_error_step, split_status, ocr_status, vector_status, uploaded_at, meta")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });

  const docs = (documents ?? []) as Array<ProcessingDocument & { id: string }>;
  const drawingIds = docs.filter((doc) => quantitiesAllowedForDocType(doc.doc_type)).map((doc) => doc.id);

  const { data: pages } = drawingIds.length
    ? await db.from("document_pages").select("id, document_id").eq("tenant_id", tenantId).in("document_id", drawingIds)
    : { data: [] };
  const { data: calibrations } = await db
    .from("sheet_calibrations")
    .select("page_id, status, page_space_scale_factor")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  const calibrated = new Set(
    ((calibrations ?? []) as Array<{ page_id: string; status: string; page_space_scale_factor: number | null }>)
      .filter((row) => row.status === "verified" && row.page_space_scale_factor != null)
      .map((row) => row.page_id),
  );

  const { count: pendingReviewCount } = await db
    .from("takeoff_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("review_status", ["suggested", "reviewed"]);

  const { data: estimates } = await db
    .from("estimates")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  const estimateIds = ((estimates ?? []) as Array<{ id: string }>).map((estimate) => estimate.id);
  const { data: versions } = estimateIds.length
    ? await db.from("estimate_versions").select("id, status").in("estimate_id", estimateIds)
    : { data: [] };
  const draftIds = ((versions ?? []) as Array<{ id: string; status: string }>)
    .filter((version) => version.status === "draft" || version.status === "review")
    .map((version) => version.id);
  const { data: lines } = draftIds.length
    ? await db.from("estimate_items").select("pricing_status, notes, estimate_version_id").eq("tenant_id", tenantId).in("estimate_version_id", draftIds)
    : { data: [] };
  let unpricedCount = 0;
  let sourceRemovedCount = 0;
  for (const line of (lines ?? []) as Array<{ pricing_status: string | null; notes: string | null }>) {
    if (isSourceRemoved(line)) sourceRemovedCount += 1;
    else if (line.pricing_status === "unpriced" || line.pricing_status === "review") unpricedCount += 1;
  }

  const report = estimateReadiness({
    documents: docs,
    sheets: ((pages ?? []) as Array<{ id: string }>).map((page) => ({
      pageId: page.id,
      calibrated: calibrated.has(page.id),
    })),
    pendingReviewCount: pendingReviewCount ?? 0,
    unpricedCount,
    sourceRemovedCount,
  });
  return NextResponse.json(report);
}
