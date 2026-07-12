import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { assertVersionEditable, getServiceDb, loadVersionForTenant, NotFoundError, VersionLockedError } from "@/lib/estimating/versioning";
import { recordEstimateAudit } from "@/lib/estimating/audit";

export const runtime = "nodejs";

type AdjustableField = "profit_pct" | "contingency_pct" | "overhead_pct";

interface BuyerAdjustmentBody {
  field?: AdjustableField;
  proposed_value?: number;
  reason?: string;
  confirm?: boolean;
}

const ADJUSTABLE_FIELDS: readonly AdjustableField[] = ["profit_pct", "contingency_pct", "overhead_pct"];

/**
 * POST /api/estimate/versions/[id]/buyer-adjustment
 *
 * STEP 7: buyer-specific pricing adjustments (profit/contingency/overhead —
 * retainage/bond/admin-burden/payment-risk fields don't have dedicated
 * estimate_versions columns today, see REMAINING_RISKS.md; this endpoint
 * covers the three percentage fields that do exist and are the primary
 * profit-affecting levers).
 *
 * Two-step confirmation, not a single trusting write:
 *  - confirm: false/omitted -> returns { original_value, proposed_value,
 *    financial_effect } WITHOUT writing anything. This is what STEP 7 means
 *    by "do not automatically apply... without showing original/proposed/
 *    reason/financial effect."
 *  - confirm: true -> applies the change (only to a draft/review version)
 *    and records an audit entry with the before/after percentages and the
 *    stated reason.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as BuyerAdjustmentBody;
  if (!body.field || !ADJUSTABLE_FIELDS.includes(body.field)) {
    return NextResponse.json({ error: `field must be one of: ${ADJUSTABLE_FIELDS.join(", ")}` }, { status: 400 });
  }
  if (typeof body.proposed_value !== "number" || !Number.isFinite(body.proposed_value)) {
    return NextResponse.json({ error: "proposed_value must be a finite number" }, { status: 400 });
  }

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

  const originalValue = version[body.field] ?? 0;
  const { data: items } = await db
    .from("estimate_items")
    .select("total_direct_cost, indirect_cost, contingency, overhead")
    .eq("estimate_version_id", id);
  const directPlusIndirectPlusOther = (items ?? []).reduce((s: number, it: Record<string, number>) => {
    const base = it.total_direct_cost + it.indirect_cost + (body.field === "contingency_pct" ? 0 : it.contingency) + (body.field === "overhead_pct" ? 0 : it.overhead);
    return s + base;
  }, 0);
  const originalDollarAmount = directPlusIndirectPlusOther * (originalValue / 100);
  const proposedDollarAmount = directPlusIndirectPlusOther * (body.proposed_value / 100);
  const financialEffect = proposedDollarAmount - originalDollarAmount;

  if (!body.confirm) {
    return NextResponse.json({
      field: body.field,
      original_value: originalValue,
      proposed_value: body.proposed_value,
      original_dollar_amount: Math.round(originalDollarAmount * 100) / 100,
      proposed_dollar_amount: Math.round(proposedDollarAmount * 100) / 100,
      financial_effect: Math.round(financialEffect * 100) / 100,
      reason: body.reason ?? null,
      applied: false,
    });
  }

  try {
    assertVersionEditable(version.status);
  } catch (e) {
    if (e instanceof VersionLockedError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { data: updated, error } = await db
    .from("estimate_versions")
    .update({ [body.field]: body.proposed_value })
    .eq("id", id)
    .select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordEstimateAudit(db, {
    tenantId, projectId: version.project_id, estimateId: version.estimate_id, estimateVersionId: id,
    entityType: "version", entityId: id, action: "buyer_adjustment", actorUserId: userId,
    before: { [body.field]: originalValue },
    after: { [body.field]: body.proposed_value, reason: body.reason ?? null, financial_effect: financialEffect },
  });

  return NextResponse.json({
    field: body.field, original_value: originalValue, proposed_value: body.proposed_value,
    financial_effect: Math.round(financialEffect * 100) / 100, applied: true, version: updated,
  });
}
