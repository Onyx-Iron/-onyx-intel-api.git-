import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { assertPermission } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";
import { TAKEOFF_JOB_STATES, type TakeoffJobState } from "@/lib/takeoff/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "read");
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: job } = await anyDb.from("takeoff_jobs").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!job) return NextResponse.json({ error: "Takeoff job not found" }, { status: 404 });
    const [{ data: units, error: unitError }, { data: events, error: eventError }] = await Promise.all([
      anyDb.from("takeoff_job_units").select("*").eq("job_id", id).eq("tenant_id", tenantId).order("created_at"),
      anyDb.from("takeoff_job_events").select("*").eq("job_id", id).eq("tenant_id", tenantId).order("id"),
    ]);
    if (unitError || eventError) return NextResponse.json({ error: unitError?.message ?? eventError?.message }, { status: 500 });
    return NextResponse.json({ job, units: units ?? [], events: events ?? [] });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await req.json() as Record<string, unknown>;
    const nextState = body.nextState as TakeoffJobState;
    const expectedRowVersion = body.expectedRowVersion;
    if (!TAKEOFF_JOB_STATES.includes(nextState) || !Number.isInteger(expectedRowVersion)) {
      return NextResponse.json({ error: "nextState and integer expectedRowVersion are required" }, { status: 400 });
    }
    const entityType = body.entityType === "unit" ? "unit" : "job";
    const entityId = entityType === "unit" && typeof body.unitId === "string" ? body.unitId : id;
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any).rpc("transition_takeoff_state", {
      p_tenant_id: tenantId,
      p_job_id: id,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_expected_row_version: expectedRowVersion,
      p_next_state: nextState,
      p_actor_user_id: userId,
      p_reason: typeof body.reason === "string" ? body.reason : null,
      p_event_data: body.eventData && typeof body.eventData === "object" ? body.eventData : {},
    });
    if (error) {
      const conflict = /row version conflict/i.test(error.message);
      return NextResponse.json({ error: error.message }, { status: conflict ? 409 : 422 });
    }
    return NextResponse.json({ transition: data });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
