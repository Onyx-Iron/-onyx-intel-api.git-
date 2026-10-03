import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

/** Non-quantity sheet markups — never sync to estimates. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  const pageId = req.nextUrl.searchParams.get("page_id");
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
  let q = (db as any).from("sheet_markups").select("*").eq("tenant_id", tenantId).eq("project_id", projectId);
  if (pageId) q = q.eq("page_id", pageId);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ markups: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    page_id?: string;
    markup_type?: string;
    geometry?: Record<string, unknown>;
    label?: string;
    color?: string;
  };
  if (!body.project_id || !body.markup_type) {
    return NextResponse.json({ error: "project_id and markup_type required" }, { status: 400 });
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
    .from("sheet_markups")
    .insert({
      tenant_id: tenantId,
      project_id: body.project_id,
      page_id: body.page_id ?? null,
      markup_type: body.markup_type,
      geometry: body.geometry ?? {},
      label: body.label ?? null,
      color: body.color ?? "#F5A623",
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ markup: data }, { status: 201 });
}
