import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import {
  matchBudgetLineCarryForward,
  revisedBudgetAfterCarry,
  snapshotBudget,
  type BudgetLineCarry,
  type BudgetSourceItem,
  type CarryBudgetLine,
} from "@/lib/estimating/budget";

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

const LINE_PAGE = 1000;

async function loadBudgetLines(
  db: Awaited<ReturnType<typeof getServiceDb>>,
  tenantId: string,
  budgetId: string,
): Promise<CarryBudgetLine[]> {
  const rows: CarryBudgetLine[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < LINE_PAGE * 100; offset += LINE_PAGE) {
    const { data, error } = await db
      .from("project_budget_lines")
      .select("id, source_takeoff_id, csi_code, description, original_amount, total_price, approved_change_amount, forecast_override")
      .eq("tenant_id", tenantId)
      .eq("budget_id", budgetId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + LINE_PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as CarryBudgetLine[];
    let added = 0;
    for (const row of batch) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      added += 1;
    }
    if (added === 0 || batch.length < LINE_PAGE) break;
  }
  return rows;
}

async function carryBudgetLines(
  db: Awaited<ReturnType<typeof getServiceDb>>,
  tenantId: string,
  projectId: string,
  carries: BudgetLineCarry[],
): Promise<void> {
  const pointedTables = [
    "project_cost_entries",
    "project_commitment_lines",
    "change_event_lines",
    "daily_log_quantities",
  ] as const;
  for (const carry of carries) {
    const { error: amountError } = await db
      .from("project_budget_lines")
      .update({
        approved_change_amount: carry.approvedChange,
        forecast_override: carry.forecastOverride,
      })
      .eq("id", carry.toId)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId);
    if (amountError) throw new Error(amountError.message);

    for (const table of pointedTables) {
      const { error } = await db
        .from(table)
        .update({ budget_line_id: carry.toId })
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("budget_line_id", carry.fromId);
      if (error) throw new Error(error.message);
    }

    const { error: toLinkError } = await db
      .from("project_record_links")
      .update({ to_id: carry.toId })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("to_type", "budget_line")
      .eq("to_id", carry.fromId);
    if (toLinkError) throw new Error(toLinkError.message);

    const { error: fromLinkError } = await db
      .from("project_record_links")
      .update({ from_id: carry.toId })
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("from_type", "budget_line")
      .eq("from_id", carry.fromId);
    if (fromLinkError) throw new Error(fromLinkError.message);
  }
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

  const { data: items, error: itemError } = await db
    .from("estimate_items")
    .select("id, source_takeoff_id, csi_code, description, quantity, uom, labor_cost, material_cost, equipment_cost, total_price, sort_order")
    .eq("estimate_version_id", id)
    .order("sort_order", { ascending: true });
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });

  const snapshot = snapshotBudget((items ?? []) as BudgetSourceItem[]);
  const { data: previousBudget, error: previousBudgetError } = await db
    .from("project_budgets")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", version.project_id)
    .eq("is_current", true)
    .maybeSingle();
  if (previousBudgetError) return NextResponse.json({ error: previousBudgetError.message }, { status: 500 });
  let previousLines: CarryBudgetLine[] = [];
  try {
    previousLines = previousBudget ? await loadBudgetLines(db, tenantId, previousBudget.id) : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the current budget";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await db
    .from("project_budgets")
    .update({ is_current: false })
    .eq("tenant_id", tenantId)
    .eq("project_id", version.project_id)
    .eq("is_current", true);

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
      is_current: true,
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
        original_amount: line.total_price,
        approved_change_amount: 0,
      })),
    );
    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  }

  let nextLines: CarryBudgetLine[] = [];
  try {
    nextLines = await loadBudgetLines(db, tenantId, budget.id);
    const carries = matchBudgetLineCarryForward(previousLines, nextLines);
    await carryBudgetLines(db, tenantId, version.project_id, carries);
    const revised = revisedBudgetAfterCarry(nextLines, carries);
    const { error: headerError } = await db
      .from("projects")
      .update({ budget: revised })
      .eq("id", version.project_id)
      .eq("tenant_id", tenantId);
    if (headerError) return NextResponse.json({ error: headerError.message }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not keep posted costs on the new budget";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const saved = await loadSnapshot(db, tenantId, id);
  return NextResponse.json({ tenant_id: tenantId, created: true, ...saved });
}
