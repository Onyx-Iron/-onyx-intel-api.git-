import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { assertPermission, getUserRole, PermissionError, redactFinancialFields } from "@/lib/project-controls/permissions";
import { VERSION_MARKUP_FIELDS } from "@/lib/project-controls/financial-redaction";
import { createDraftFromVersion, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { recordEstimateAudit } from "@/lib/estimating/audit";

export const runtime = "nodejs";

/**
 * GET  ?project_id=          -> { estimate, versions: [...] } for the project's one authoritative estimate
 * POST { project_id }        -> create the estimate + Version 1 draft (if none exists yet)
 * POST { source_version_id, duplicate: true } -> create a new draft copied from an existing version
 *      (used for both "edit an approved estimate" and "restore as new draft" / "duplicate version")
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
  } catch {
    return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: estimate } = await anyDb
    .from("estimates")
    .select("*")
    .eq("tenant_id", tenantId).eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!estimate) return NextResponse.json({ estimate: null, versions: [] });

  const { data: versions, error } = await anyDb
    .from("estimate_versions")
    .select("*")
    .eq("estimate_id", estimate.id)
    .order("version_number", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const role = await getUserRole(tenantId, userId);
  const visibleVersions = redactFinancialFields(
    (versions ?? []) as Record<string, unknown>[],
    role,
    VERSION_MARKUP_FIELDS,
  );

  return NextResponse.json({ estimate, versions: visibleVersions });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    source_version_id?: string;
    version_name?: string;
    notes?: string;
  };

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "write");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // Path A: duplicate/restore an existing version as a new draft. The
  // version's own estimate_id (not a client-supplied one) determines which
  // estimate the new draft belongs to — never trust a project_id/estimate_id
  // pairing supplied alongside a version_id without verifying it server-side.
  if (body.source_version_id) {
    let source;
    try {
      source = await loadVersionForTenant(anyDb, body.source_version_id, tenantId);
    } catch (e) {
      if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
      throw e;
    }

    const newVersion = await createDraftFromVersion(anyDb, {
      estimateId: source.estimate_id, sourceVersionId: source.id, userId,
      versionName: body.version_name, notes: body.notes ?? `Duplicated from version ${source.version_number}`,
    });

    void recordEstimateAudit(anyDb, {
      tenantId, estimateId: source.estimate_id, estimateVersionId: newVersion.id,
      entityType: "version", entityId: newVersion.id, action: "created", actorUserId: userId,
      after: newVersion as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ version: newVersion }, { status: 201 });
  }

  // Path B: create the project's first estimate + Version 1 draft.
  if (!body.project_id) return NextResponse.json({ error: "project_id or source_version_id required" }, { status: 400 });
  try {
    await assertProjectBelongsToTenant(body.project_id, tenantId);
  } catch {
    return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
  }

  const { data: existingEstimate } = await anyDb
    .from("estimates")
    .select("id")
    .eq("tenant_id", tenantId).eq("project_id", body.project_id)
    .maybeSingle();
  if (existingEstimate) {
    return NextResponse.json({ error: "An estimate already exists for this project. Use source_version_id to create a new draft." }, { status: 409 });
  }

  const { data: estimate, error: estError } = await anyDb
    .from("estimates")
    .insert({
      tenant_id: tenantId, project_id: body.project_id,
      estimate_number: `EST-${crypto.randomUUID().slice(0, 8)}`,
      name: "New Estimate", status: "draft", created_by: userId, updated_by: userId,
    })
    .select("*").single();
  if (estError) return NextResponse.json({ error: estError.message }, { status: 500 });

  const { data: version, error: vError } = await anyDb
    .from("estimate_versions")
    .insert({ estimate_id: estimate.id, version_number: 1, version_name: body.version_name ?? "Version 1", status: "draft", created_by: userId, notes: body.notes ?? null })
    .select("*").single();
  if (vError) return NextResponse.json({ error: vError.message }, { status: 500 });

  await anyDb.from("estimates").update({ current_version_id: version.id }).eq("id", estimate.id);

  void recordEstimateAudit(anyDb, {
    tenantId, projectId: body.project_id, estimateId: estimate.id, estimateVersionId: version.id,
    entityType: "estimate", entityId: estimate.id, action: "created", actorUserId: userId, after: estimate,
  });

  return NextResponse.json({ estimate, version }, { status: 201 });
}
