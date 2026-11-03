import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/types";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { auditUpdate, auditDelete } from "@/lib/audit";
import { assertScheduleChangeIsAcyclic, recomputeProjectSchedule } from "@/lib/project-file/schedule-store";
import { CpmCycleError } from "@/lib/project-file/cpm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const body = await req.json();
    const {
      name,
      status,
      start_date,
      end_date,
      duration,
      critical,
      es,
      ef,
      ls,
      lf,
      total_float,
      free_float,
      deps,
      percent_complete,
    } = body as {
      name?: string;
      status?: string;
      start_date?: string;
      end_date?: string;
      duration?: number;
      critical?: boolean;
      es?: number;
      ef?: number;
      ls?: number;
      lf?: number;
      total_float?: number;
      free_float?: number;
      deps?: string[];
      percent_complete?: number | null;
    };

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    const updates: TablesUpdate<"schedule_tasks"> = {};
    if (name !== undefined) updates.name = name;
    if (status !== undefined) updates.status = status;
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_date !== undefined) updates.end_date = end_date;
    if (duration !== undefined) updates.duration = duration;
    if (critical !== undefined) updates.critical = critical;
    if (es !== undefined) updates.es = es;
    if (ef !== undefined) updates.ef = ef;
    if (ls !== undefined) updates.ls = ls;
    if (lf !== undefined) updates.lf = lf;
    if (total_float !== undefined) updates.total_float = total_float;
    if (free_float !== undefined) updates.free_float = free_float;
    if (deps !== undefined) updates.deps = deps;
    if (percent_complete !== undefined) updates.percent_complete = percent_complete;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const db = await createServiceClient();
    const { data: before } = await db
      .from("schedule_tasks")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const touchesScheduleMath = deps !== undefined || duration !== undefined || start_date !== undefined || end_date !== undefined;
    if (before && touchesScheduleMath) {
      try {
        await assertScheduleChangeIsAcyclic(db, tenantId, before.project_id, {
          id,
          duration: duration !== undefined ? duration : before.duration,
          start_date: start_date !== undefined ? start_date : before.start_date,
          end_date: end_date !== undefined ? end_date : before.end_date,
          deps: deps !== undefined ? deps : before.deps,
        });
      } catch (err) {
        if (err instanceof CpmCycleError) {
          return NextResponse.json({ error: err.message }, { status: 409 });
        }
        throw err;
      }
    }

    const { data, error } = await db
      .from("schedule_tasks")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: `[PUT /api/schedule/${id}] ${error.message}` }, { status: 422 });
    }

    if (before && touchesScheduleMath) {
      try {
        await recomputeProjectSchedule(db, tenantId, before.project_id);
      } catch (err) {
        if (err instanceof CpmCycleError) {
          const { error: restoreError } = await db
            .from("schedule_tasks")
            .update({
              name: before.name,
              status: before.status,
              start_date: before.start_date,
              end_date: before.end_date,
              duration: before.duration,
              critical: before.critical,
              deps: before.deps,
              percent_complete: before.percent_complete,
              es: before.es,
              ef: before.ef,
              ls: before.ls,
              lf: before.lf,
              total_float: before.total_float,
              free_float: before.free_float,
            })
            .eq("id", id)
            .eq("tenant_id", tenantId);
          if (restoreError) {
            return NextResponse.json({ error: restoreError.message }, { status: 500 });
          }
          return NextResponse.json({ error: err.message }, { status: 409 });
        }
        throw err;
      }
    }

    auditUpdate({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "schedule_tasks",
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
      new_values: data as Record<string, unknown>,
    });

    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[PUT /api/schedule/[id]] ${msg}` }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "field", "write");
    if (denied) return denied;

    const db = await createServiceClient();
    const { data: before } = await db
      .from("schedule_tasks")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { error } = await db
      .from("schedule_tasks")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json({ error: `[DELETE /api/schedule/${id}] ${error.message}` }, { status: 422 });
    }

    auditDelete({
      tenant_id: tenantId,
      user_id: userId,
      table_name: "schedule_tasks",
      record_id: id,
      old_values: (before ?? null) as Record<string, unknown> | null,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/schedule/[id]] ${msg}` }, { status: 500 });
  }
}
