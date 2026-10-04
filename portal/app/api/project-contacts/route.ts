import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try { await assertProjectBelongsToTenant(projectId, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("project_contacts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project_contacts: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    contact_id?: string;
    role_on_project?: string;
    is_primary?: boolean;
  };
  if (!body.project_id || !body.contact_id) {
    return NextResponse.json({ error: "project_id and contact_id required" }, { status: 400 });
  }
  try { await assertProjectBelongsToTenant(body.project_id, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("project_contacts")
    .upsert({
      tenant_id: tenantId,
      project_id: body.project_id,
      contact_id: body.contact_id,
      role_on_project: body.role_on_project ?? null,
      is_primary: !!body.is_primary,
    }, { onConflict: "tenant_id,project_id,contact_id" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project_contact: data }, { status: 201 });
}
