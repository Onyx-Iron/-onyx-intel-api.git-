import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { projectMoneyFromAggregate, projectMoneyFromRows, type ProjectMoney } from "@/lib/project-controls/money";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

// counts a table for a project; tolerates tables that may not exist yet (returns 0)
async function countTable(db: Awaited<ReturnType<typeof createServiceClient>>, table: string, tenantId: string, projectId: string, extra?: (q: ReturnType<typeof db.from>) => unknown): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(table as never).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("project_id", projectId);
    if (extra) q = extra(q);
    const { count, error } = await q;
    if (error) return 0;
    return count ?? 0;
  } catch { return 0; }
}

// Prefer the SQL aggregate. If the function is not installed yet, fall back to
// the previous row download so the overview still renders.
async function loadProjectMoney(db: {
  rpc: (fn: string, args: Record<string, string>) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          limit: (count: number) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
}, tenantId: string, projectId: string): Promise<ProjectMoney> {
  try {
    const aggregated = await db.rpc("project_money_totals", { p_tenant_id: tenantId, p_project_id: projectId });
    const row = Array.isArray(aggregated.data) ? aggregated.data[0] : aggregated.data;
    if (!aggregated.error && row) return projectMoneyFromAggregate(row);
  } catch {
    // The aggregate is optional until the migration is applied.
  }

  const [estimates, changeOrders] = await Promise.all([
    db.from("estimate_items").select("quantity,unit_cost").eq("tenant_id", tenantId).eq("project_id", projectId).limit(5000),
    db.from("change_order_items").select("status,amount").eq("tenant_id", tenantId).eq("project_id", projectId).limit(5000),
  ]);
  return projectMoneyFromRows(
    estimates.error ? [] : (estimates.data as Array<{ quantity: number | null; unit_cost: number | null }> ?? []),
    changeOrders.error ? [] : (changeOrders.data as Array<{ status: string | null; amount: number | null }> ?? []),
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;

    const [
      takeoff_items, documents, schedule_tasks, contacts, daily_logs, generated_docs,
      procurement_total, procurement_pending, punch_total, punch_open, permits_total, permits_approved,
      money, scheduleDone, rfisOpen, submittalsOpen,
    ] = await Promise.all([
      countTable(db, "takeoff_items", tenantId, projectId),
      countTable(db, "documents", tenantId, projectId),
      countTable(db, "schedule_tasks", tenantId, projectId),
      countTable(db, "contacts", tenantId, projectId),
      countTable(db, "daily_logs", tenantId, projectId),
      countTable(db, "generated_documents", tenantId, projectId),
      countTable(db, "procurement_items", tenantId, projectId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "procurement_items", tenantId, projectId, (q: any) => q.eq("status", "pending")),
      countTable(db, "punch_list_items", tenantId, projectId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "punch_list_items", tenantId, projectId, (q: any) => q.in("status", ["open", "in_progress"])),
      countTable(db, "permit_items", tenantId, projectId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "permit_items", tenantId, projectId, (q: any) => q.eq("status", "approved")),
      loadProjectMoney(anyDb, tenantId, projectId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "schedule_tasks", tenantId, projectId, (q: any) => q.eq("status", "complete")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "rfi_items", tenantId, projectId, (q: any) => q.in("status", ["open", "answered"])),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "submittal_items", tenantId, projectId, (q: any) => q.in("status", ["submitted", "under_review", "revise_resubmit", "rejected"])),
    ]);

    const completion = schedule_tasks > 0 ? Math.round((scheduleDone / schedule_tasks) * 100) : 0;

    return NextResponse.json({
      takeoff_items, documents, schedule_tasks, contacts, daily_logs, generated_docs,
      procurement_total, procurement_pending, punch_total, punch_open,
      permits_total, permits_approved,
      rfis_open: rfisOpen,
      submittals_open: submittalsOpen,
      change_orders_pending: money.change_orders_pending,
      change_orders_approved: money.change_orders_approved,
      pending_change_order_value: money.pending_change_order_value,
      approved_change_order_value: money.approved_change_order_value,
      estimate_value: money.estimate_value,
      completion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/overview] ${msg}` }, { status: 500 });
  }
}
