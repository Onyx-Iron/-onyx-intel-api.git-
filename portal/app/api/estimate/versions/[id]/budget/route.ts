import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { BudgetPublishError, publishApprovedBudget, snapshotBudget, type BudgetSourceItem } from "@/lib/estimating/budget";

export const runtime = "nodejs";

async function loadSnapshot(db: Awaited<ReturnType<typeof getServiceDb>>, tenantId: string, versionId: string) {
  const { data: budget, error } = await db
    .from("project_budgets")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("source_estimate_version_id", versionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!budget) return null;
  const { data: lines, error: lineError } = await db
    .from("project_budget_lines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("budget_id", budget.id)
    .order("sort_order", { ascending: true });
  if (lineError) throw new Error(lineError.message);
  return { budget, lines: lines ?? [] };
}

/** GET the budget snapshotted from this approved version, if one exists. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await getServiceDb();
  try {
    await loadVersionForTenant(db, id, tenantId);
    const snapshot = await loadSnapshot(db, tenantId, id);
    if (!snapshot) return NextResponse.json({ error: "No budget for this version" }, { status: 404 });
    return NextResponse.json({ tenant_id: tenantId, ...snapshot });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    const message = e instanceof Error ? e.message : "Budget lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST copies this approved version's lines into a project budget. Drafts are rejected. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
  if (version.status !== "approved") {
    return NextResponse.json({ error: "Only an approved version can become a budget." }, { status: 409 });
  }

  const { data: items, error: itemError } = await db
    .from("estimate_items")
    .select("id, source_takeoff_id, csi_code, description, quantity, uom, labor_cost, material_cost, equipment_cost, total_price, sort_order")
    .eq("estimate_version_id", id)
    .order("sort_order", { ascending: true });
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });

  try {
    const published = await publishApprovedBudget(db, {
      tenantId,
      projectId: version.project_id,
      versionId: version.id,
      versionNumber: version.version_number,
      userId,
      snapshot: snapshotBudget((items ?? []) as BudgetSourceItem[]),
    });
    return NextResponse.json({ tenant_id: tenantId, ...published });
  } catch (e) {
    if (e instanceof BudgetPublishError) return NextResponse.json({ error: e.message }, { status: 500 });
    throw e;
  }
}
