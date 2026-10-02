import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getControlSummary } from "@/lib/project-controls/schema";
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
      estimateRows, scheduleDone, rfisOpen, submittalsOpen, changeOrderRows,
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
      // estimate value
      db.from("estimate_items" as never).select("quantity,unit_cost").eq("tenant_id", tenantId).eq("project_id", projectId).limit(5000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "schedule_tasks", tenantId, projectId, (q: any) => q.eq("status", "complete")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "rfi_items", tenantId, projectId, (q: any) => q.in("status", ["open", "answered"])),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countTable(db, "submittal_items", tenantId, projectId, (q: any) => q.in("status", ["submitted", "under_review", "revise_resubmit", "rejected"])),
      anyDb.from("change_order_items").select("status,amount").eq("tenant_id", tenantId).eq("project_id", projectId).limit(5000),
    ]);

    let estimate_value = 0;
    if (!estimateRows.error) {
      for (const r of (estimateRows.data ?? []) as Array<{ quantity: number | null; unit_cost: number | null }>) {
        if (r.quantity != null && r.unit_cost != null) estimate_value += r.quantity * r.unit_cost;
      }
    }
    const completion = schedule_tasks > 0 ? Math.round((scheduleDone / schedule_tasks) * 100) : 0;
    const controls = getControlSummary({
      rfis: [],
      submittals: [],
      changeOrders: changeOrderRows.error ? [] : (changeOrderRows.data ?? []),
    });

    return NextResponse.json({
      takeoff_items, documents, schedule_tasks, contacts, daily_logs, generated_docs,
      procurement_total, procurement_pending, punch_total, punch_open,
      permits_total, permits_approved,
      ...controls,
      rfis_open: rfisOpen,
      submittals_open: submittalsOpen,
      estimate_value: Math.round(estimate_value),
      completion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/overview] ${msg}` }, { status: 500 });
  }
}
