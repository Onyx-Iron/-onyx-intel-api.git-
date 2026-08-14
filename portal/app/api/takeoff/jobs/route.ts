import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import type { ConfirmedTakeoffScope, TakeoffScopeMode } from "@/lib/takeoff/contracts";
import { assertPermission } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES = new Set<TakeoffScopeMode>(["complete", "trades", "bid_packages", "documents", "alternates"]);

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()))].sort();
}

function buildScope(value: unknown, userId: string): ConfirmedTakeoffScope {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const mode = input.mode as TakeoffScopeMode;
  if (!MODES.has(mode)) throw new Error("Choose a complete estimate or a specific trade, package, document, sheet, or alternate scope");
  const scope: ConfirmedTakeoffScope = {
    mode,
    tradeCodes: stringArray(input.tradeCodes),
    bidPackageIds: stringArray(input.bidPackageIds),
    documentIds: stringArray(input.documentIds),
    sheetIds: stringArray(input.sheetIds),
    alternateIds: stringArray(input.alternateIds),
    confirmedAt: new Date().toISOString(),
    confirmedBy: userId,
  };
  const selected = scope.tradeCodes.length + scope.bidPackageIds.length + scope.documentIds.length + scope.sheetIds.length + scope.alternateIds.length;
  if (mode !== "complete" && selected === 0) throw new Error("The selected processing scope is empty");
  return scope;
}

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
    return NextResponse.json({ jobs: data ?? [] });
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
    const scope = buildScope(body.scope, userId);
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
