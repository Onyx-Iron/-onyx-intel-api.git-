import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildChangeOrderUpdate } from "@/lib/project-controls/schema";
import {
  authTenantKey,
  authTenantName,
  getControlDb,
  getOrCreateTenant,
} from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate, auditDelete } from "@/lib/audit";
import {
  budgetAlreadyPosted,
  changeOrderBudgetDelta,
  withBudgetPosted,
  type ChangeOrderBudgetWeight,
} from "@/lib/project-file/money";
import { addApprovedChange } from "@/lib/project-file/budget-store";
import type { AnyDb } from "@/lib/project-file/api";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const updates = { ...buildChangeOrderUpdate(body), updated_at: new Date().toISOString() };
    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    const db = await getControlDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: before } = await (db as any)
      .from("change_order_items")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!before) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

    const { data, error } = await db
      .from<unknown>("change_order_items")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", before.status)
      .select()
      .single();

    if (isLostClaim(error, data)) {
      return NextResponse.json({ error: "Change order changed concurrently. Refresh and retry." }, { status: 409 });
    }
    if (error) return NextResponse.json({ error: "Change Orders are not yet available in this workspace.", code: "FEATURE_UNAVAILABLE" }, { status: 503 });

    const next = data as { status?: string; amount?: number | null; project_id?: string; meta?: unknown };
    const previous = before as { status?: string; amount?: number | null; project_id?: string; meta?: unknown };
    try {
      await syncChangeOrderBudget(db as AnyDb, tenantId, previous.project_id, id, previous, next);
    } catch (budgetErr) {
      await db
        .from<unknown>("change_order_items")
        .update({ status: previous.status, amount: previous.amount ?? null })
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .eq("status", next.status ?? previous.status);
      throw budgetErr;
    }

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "change_order_items",
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
      new_values: data as Record<string, unknown>,
    });

    return NextResponse.json({ item: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    const db = await getControlDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: before } = await (db as any)
      .from("change_order_items")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!before) return NextResponse.json({ error: "Change order not found" }, { status: 404 });
    const previous = before as { status?: string; amount?: number | null; project_id?: string; meta?: unknown };

    const { data: removed, error } = await db
      .from<{ id: string }>("change_order_items")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", previous.status)
      .select("id")
      .single();

    if (isLostClaim(error, removed)) {
      return NextResponse.json({ error: "Change order changed concurrently. Refresh and retry." }, { status: 409 });
    }
    if (error) return NextResponse.json({ error: "Change Orders are not yet available in this workspace.", code: "FEATURE_UNAVAILABLE" }, { status: 503 });

    if (previous.status === "approved" && previous.project_id) {
      await syncChangeOrderBudget(db as AnyDb, tenantId, previous.project_id, id, previous, {
        status: "void",
        amount: previous.amount ?? null,
        meta: previous.meta,
      });
    }

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "change_order_items",
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function isLostClaim(error: { message: string } | null, data: unknown): boolean {
  if (data) return false;
  if (!error) return true;
  return /0 rows|no\) rows|cannot coerce|PGRST116/i.test(error.message);
}

async function syncChangeOrderBudget(
  db: AnyDb,
  tenantId: string,
  projectId: string | undefined,
  changeOrderId: string,
  previous: { status?: string; amount?: number | null; meta?: unknown },
  next: { status?: string; amount?: number | null; meta?: unknown },
): Promise<void> {
  if (!projectId) return;
  const { data: links, error: linkError } = await db
    .from("project_record_links")
    .select("to_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("from_type", "change_order")
    .eq("from_id", changeOrderId)
    .eq("link_role", "prices")
    .eq("to_type", "budget_line");
  if (linkError) throw new Error(linkError.message);

  const { data: events, error: eventError } = await db
    .from("change_events")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("change_order_id", changeOrderId);
  if (eventError) throw new Error(eventError.message);
  const eventIds = (events ?? []).map((row: { id: string }) => row.id);
  let eventLines: ChangeOrderBudgetWeight[] = [];
  if (eventIds.length > 0) {
    const { data: lines, error: lineError } = await db
      .from("change_event_lines")
      .select("budget_line_id, amount")
      .eq("tenant_id", tenantId)
      .in("change_event_id", eventIds);
    if (lineError) throw new Error(lineError.message);
    eventLines = (lines ?? []).flatMap((line: { budget_line_id: string | null; amount: number | null }) => {
      if (!line.budget_line_id) return [];
      return [{ budgetLineId: line.budget_line_id, amount: Number(line.amount ?? 0) }];
    });
  }

  const allocations = changeOrderBudgetDelta(
    { status: previous.status ?? "", amount: Number(previous.amount ?? 0) },
    { status: next.status ?? "", amount: Number(next.amount ?? 0) },
    (links ?? []).map((link: { to_id: string }) => link.to_id),
    eventLines,
  );
  if (allocations.length === 0) return;

  const net = allocations.reduce((sum, row) => sum + row.amount, 0);
  // First-post guard from #115: do not add again when already posted.
  if (net > 0 && budgetAlreadyPosted(previous.meta)) return;

  await addApprovedChange(db, tenantId, projectId, allocations);

  if (net > 0) {
    const { error: flagError } = await db
      .from("change_order_items")
      .update({ meta: withBudgetPosted(previous.meta) })
      .eq("id", changeOrderId)
      .eq("tenant_id", tenantId);
    if (flagError) throw new Error(flagError.message);
  }
}
