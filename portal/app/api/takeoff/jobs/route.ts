import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { assertPermission } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sanitizeConfirmedTakeoffScope } from "@/lib/takeoff/scope-confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const projectId = req.nextUrl.searchParams.get("project_id");
    if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "read");
    const db = await createServiceClient();
    const { data, error } = await db.from("takeoff_jobs" as never).select("*")
      .eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const jobs = (data ?? []) as Array<Record<string, unknown>>;
    const jobIds = jobs.map((job) => String(job.id));
    if (jobIds.length === 0) return NextResponse.json({ jobs: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const [{ data: units, error: unitsError }, { data: candidates, error: candidatesError }] = await Promise.all([
      anyDb.from("takeoff_job_units").select("id,job_id,unit_type,source_id,state,attempt_count,last_error")
        .eq("tenant_id", tenantId).eq("project_id", projectId).in("job_id", jobIds).order("created_at", { ascending: true }),
      anyDb.from("takeoff_items").select("takeoff_job_id,review_status,quantity_validation_status")
        .eq("tenant_id", tenantId).eq("project_id", projectId).in("takeoff_job_id", jobIds),
    ]);
    if (unitsError || candidatesError) return NextResponse.json({ error: unitsError?.message ?? candidatesError?.message }, { status: 500 });
    const enriched = jobs.map((job) => {
      const jobUnits = (units ?? []).filter((unit: Record<string, unknown>) => unit.job_id === job.id);
      const jobCandidates = (candidates ?? []).filter((candidate: Record<string, unknown>) => candidate.takeoff_job_id === job.id);
      return {
        ...job,
        units: jobUnits,
        candidate_summary: {
          total: jobCandidates.length,
          validated: jobCandidates.filter((candidate: Record<string, unknown>) => candidate.quantity_validation_status === "validated").length,
          blocked: jobCandidates.filter((candidate: Record<string, unknown>) => candidate.quantity_validation_status === "blocked").length,
          pending_approval: jobCandidates.filter((candidate: Record<string, unknown>) => candidate.review_status === "suggested" || candidate.review_status === "reviewed").length,
        },
      };
    });
    return NextResponse.json({ jobs: enriched });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json() as Record<string, unknown>;
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!projectId || body.scopeConfirmed !== true) {
      return NextResponse.json({ error: "Confirm the proposed processing scope before starting takeoff" }, { status: 400 });
    }
    const scope = sanitizeConfirmedTakeoffScope(body.scope, userId);
    const scopeHash = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "field", "write");
    const db = await createServiceClient();
    const { data: project } = await db.from("projects").select("id").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: job, error } = await anyDb.from("takeoff_jobs").insert({
      tenant_id: tenantId, project_id: projectId, scope_snapshot: scope, scope_hash: scopeHash, created_by: userId,
    }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const units = [
      ...scope.documentIds.map((source_id) => ({ unit_type: "document", source_id })),
      ...scope.sheetIds.map((source_id) => ({ unit_type: "sheet", source_id })),
      ...scope.tradeCodes.map((source_id) => ({ unit_type: "trade", source_id })),
      ...scope.bidPackageIds.map((source_id) => ({ unit_type: "bid_package", source_id })),
      ...scope.alternateIds.map((source_id) => ({ unit_type: "alternate", source_id })),
    ].map((unit) => ({ ...unit, job_id: job.id, tenant_id: tenantId, project_id: projectId }));
    if (units.length > 0) {
      const { error: unitError } = await anyDb.from("takeoff_job_units").insert(units);
      if (unitError) {
        await anyDb.from("takeoff_jobs").delete().eq("id", job.id).eq("tenant_id", tenantId);
        return NextResponse.json({ error: unitError.message }, { status: 500 });
      }
    }
    return NextResponse.json({ job, proposedUnitCount: units.length }, { status: 201 });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
