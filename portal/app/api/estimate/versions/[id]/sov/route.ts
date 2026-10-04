import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { calculateEstimateTotals } from "@/lib/estimating/calculations";
import { recordEstimateAudit } from "@/lib/estimating/audit";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

export const runtime = "nodejs";

type GroupBy = "cost_code" | "division" | "scope_category" | "phase" | "custom";

interface SovBody {
  group_by?: GroupBy;
  allow_draft_preview?: boolean;
}

interface SovItem {
  cost_code: string | null;
  scope_category: string | null;
  description: string;
  quantity: number | null;
  total_direct_cost: number;
  indirect_cost: number;
  contingency: number;
  overhead: number;
  profit: number;
  total_price: number;
  is_alternate: boolean;
  alternate_accepted: boolean;
  is_allowance: boolean;
}

/**
 * POST /api/estimate/versions/[id]/sov
 *
 * Generates a Schedule of Values grouped by the requested dimension, from
 * the same approved version a proposal would reference (STEP 10: "SOV total
 * equals estimate total. SOV total equals proposal total."). Both totals
 * are the same calculateEstimateTotals() roll-up the proposal route uses,
 * over the identical item set — the two can never drift because there is
 * only one function that knows how to sum an estimate.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as SovBody;
  const groupBy: GroupBy = body.group_by ?? "cost_code";

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
      error: `Version is '${version.status}'. Only an approved version can generate an SOV — pass allow_draft_preview:true to preview a draft.`,
    }, { status: 409 });
  }

  const loaded = await fetchAllPages<SovItem>((from, to) =>
    db
      .from("estimate_items")
      .select("cost_code, scope_category, description, quantity, total_direct_cost, indirect_cost, contingency, overhead, profit, total_price, is_alternate, alternate_accepted, is_allowance")
      .eq("estimate_version_id", id)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 500 });
  const items = loaded.rows;

  const totals = calculateEstimateTotals(
    items.map((it: SovItem) => ({
      totalDirectCost: it.total_direct_cost, indirectCost: it.indirect_cost, contingency: it.contingency,
      overhead: it.overhead, profit: it.profit, totalPrice: it.total_price,
      isAlternate: it.is_alternate, alternateAccepted: it.alternate_accepted,
    })),
  );

  // Alternates stay excluded from SOV grouping unless accepted — same rule
  // calculateEstimateTotals already applies to the total, applied here to
  // the row grouping too so the visible line items match the total.
  const included = items.filter((it: SovItem) => !it.is_alternate || it.alternate_accepted);
  const groupKeyOf = (it: SovItem): string => {
    if (groupBy === "cost_code") return it.cost_code ?? "Uncategorized";
    if (groupBy === "scope_category") return it.scope_category ?? "Uncategorized";
    if (groupBy === "division") return (it.cost_code ?? "").slice(0, 2) || "Uncategorized";
    return "Uncategorized"; // phase/custom: no dedicated column yet — grouped as one bucket, documented in REMAINING_RISKS
  };

  const groups = new Map<string, { rows: SovItem[]; total: number }>();
  for (const it of included as SovItem[]) {
    const key = groupKeyOf(it);
    const group = groups.get(key) ?? { rows: [], total: 0 };
    group.rows.push(it);
    group.total += it.total_price;
    groups.set(key, group);
  }
  const rows = Array.from(groups.entries()).map(([group, g]) => ({
    group, item_count: g.rows.length, total_price: Math.round(g.total * 100) / 100,
    items: g.rows.map((it) => ({ description: it.description, quantity: it.quantity, cost_code: it.cost_code, is_allowance: it.is_allowance, total_price: it.total_price })),
  }));

  const { data: sov, error: insError } = await db
    .from("estimate_sov")
    .insert({
      tenant_id: tenantId, project_id: version.project_id, estimate_id: version.estimate_id, estimate_version_id: id,
      group_by: groupBy, rows, total_price: totals.totalPrice, created_by: userId,
    })
    .select("*").single();
  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });

  void recordEstimateAudit(db, {
    tenantId, projectId: version.project_id, estimateId: version.estimate_id, estimateVersionId: id,
    entityType: "sov", entityId: sov.id, action: "generated", actorUserId: userId,
    after: { group_by: groupBy, total_price: sov.total_price, is_draft_preview: version.status !== "approved" },
  });

  return NextResponse.json({ sov, totals, is_draft_preview: version.status !== "approved" }, { status: 201 });
}
