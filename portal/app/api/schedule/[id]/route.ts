import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/types";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

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
    };

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");

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

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const db = await createServiceClient();
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

    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[PUT /api/schedule/[id]] ${msg}` }, { status: err instanceof PermissionError ? 403 : 500 });
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
    await assertPermission(tenantId, userId, "field", "write");

    const db = await createServiceClient();
    const { error } = await db
      .from("schedule_tasks")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json({ error: `[DELETE /api/schedule/${id}] ${error.message}` }, { status: 422 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/schedule/[id]] ${msg}` }, { status: err instanceof PermissionError ? 403 : 500 });
  }
}
