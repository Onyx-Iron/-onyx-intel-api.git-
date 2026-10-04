import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { snapshotBudget, type BudgetSourceItem } from "@/lib/estimating/budget";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

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

  const existing = await loadSnapshot(db, tenantId, id);
  if (existing) return NextResponse.json({ tenant_id: tenantId, created: false, ...existing });

  const loaded = await fetchAllPages<BudgetSourceItem>((from, to) =>
    db
      .from("estimate_items")
      .select("id, source_takeoff_id, csi_code, description, quantity, uom, labor_cost, material_cost, equipment_cost, total_price, sort_order")
      .eq("estimate_version_id", id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 500 });

  const snapshot = snapshotBudget(loaded.rows);
  const { data: budget, error: budgetError } = await db
    .from("project_budgets")
    .insert({
      tenant_id: tenantId,
      project_id: version.project_id,
      source_estimate_version_id: version.id,
      version_number: version.version_number,
      total_price: snapshot.totalPrice,
      line_count: snapshot.lineCount,
      created_by: userId,
    })
    .select("*")
    .single();
  if (budgetError) return NextResponse.json({ error: budgetError.message }, { status: 500 });

  if (snapshot.lines.length > 0) {
    const { error: lineError } = await db.from("project_budget_lines").insert(
      snapshot.lines.map((line) => ({
        ...line,
        budget_id: budget.id,
        tenant_id: tenantId,
        project_id: version.project_id,
      })),
    );
    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  }

  const saved = await loadSnapshot(db, tenantId, id);
  return NextResponse.json({ tenant_id: tenantId, created: true, ...saved });
}
