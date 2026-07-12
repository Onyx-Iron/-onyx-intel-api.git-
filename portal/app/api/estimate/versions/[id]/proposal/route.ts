import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { calculateEstimateTotals } from "@/lib/estimating/calculations";
import { recordEstimateAudit } from "@/lib/estimating/audit";

export const runtime = "nodejs";

interface ProposalBody {
  contractor_info?: Record<string, unknown>;
  customer_info?: Record<string, unknown>;
  project_info?: Record<string, unknown>;
  scope?: string;
  assumptions?: string;
  exclusions?: string;
  clarifications?: string;
  payment_terms?: string;
  schedule_assumptions?: string;
  validity_days?: number;
  allow_draft_preview?: boolean;
}

/**
 * POST /api/estimate/versions/[id]/proposal
 *
 * Generates a proposal snapshot from the referenced estimate version.
 * Refuses a non-approved version unless the caller explicitly passes
 * allow_draft_preview:true (STEP 9: "generate proposals only from an
 * approved estimate version unless the user explicitly chooses a draft
 * preview"). total_price is ALWAYS the server-recalculated version total —
 * there is no field in the request body that can override it, so
 * "proposal total equals estimate total" holds structurally, not by
 * convention.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as ProposalBody;

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

  if (version.status !== "approved" && !body.allow_draft_preview) {
    return NextResponse.json({
      error: `Version is '${version.status}'. Only an approved version can generate a proposal — pass allow_draft_preview:true to preview a draft (clearly marked as a preview, not a final proposal).`,
    }, { status: 409 });
  }

  const { data: items, error } = await db
    .from("estimate_items")
    .select("total_direct_cost, indirect_cost, contingency, overhead, profit, total_price, is_alternate, alternate_accepted, is_allowance, description, cost_code, quantity, uom")
    .eq("estimate_version_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totals = calculateEstimateTotals(
    (items ?? []).map((it: Record<string, unknown>) => ({
      totalDirectCost: it.total_direct_cost as number,
      indirectCost: it.indirect_cost as number,
      contingency: it.contingency as number,
      overhead: it.overhead as number,
      profit: it.profit as number,
      totalPrice: it.total_price as number,
      isAlternate: it.is_alternate as boolean,
      alternateAccepted: it.alternate_accepted as boolean,
    })),
  );

  const alternates = (items ?? []).filter((it: { is_alternate: boolean }) => it.is_alternate);
  const allowances = (items ?? []).filter((it: { is_allowance: boolean }) => it.is_allowance);

  const { data: proposal, error: insError } = await db
    .from("estimate_proposals")
    .insert({
      tenant_id: tenantId, project_id: version.project_id, estimate_id: version.estimate_id, estimate_version_id: id,
      proposal_number: `PROP-${crypto.randomUUID().slice(0, 8)}`,
      contractor_info: body.contractor_info ?? {},
      customer_info: body.customer_info ?? {},
      project_info: body.project_info ?? {},
      scope: body.scope ?? null,
      alternates,
      allowances,
      assumptions: body.assumptions ?? null,
      exclusions: body.exclusions ?? null,
      clarifications: body.clarifications ?? null,
      payment_terms: body.payment_terms ?? null,
      schedule_assumptions: body.schedule_assumptions ?? null,
      validity_days: body.validity_days ?? 30,
      total_price: totals.totalPrice,
      created_by: userId,
    })
    .select("*").single();
  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });

  void recordEstimateAudit(db, {
    tenantId, projectId: version.project_id, estimateId: version.estimate_id, estimateVersionId: id,
    entityType: "proposal", entityId: proposal.id, action: "generated", actorUserId: userId,
    after: { proposal_number: proposal.proposal_number, total_price: proposal.total_price, is_draft_preview: version.status !== "approved" },
  });

  return NextResponse.json({ proposal, totals, is_draft_preview: version.status !== "approved" }, { status: 201 });
}
