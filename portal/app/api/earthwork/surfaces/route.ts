import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * GET    ?project_id=              → list surfaces
 * POST   { project_id, surface_type, name?, coordinate_mesh, spot_elevations? }
 * DELETE ?id=
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data, error } = await anyDb.from("civil_surfaces")
    .select("id, surface_type, name, units, spot_elevations, updated_at")
    .eq("tenant_id", tenantId).eq("project_id", projectId)
    .order("surface_type").order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ surfaces: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    surface_type?: string;
    name?: string;
    units?: string;
    coordinate_mesh?: unknown;
    spot_elevations?: unknown;
  };
  if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });
  if (!body.surface_type) return NextResponse.json({ error: "surface_type required" }, { status: 400 });
  if (!body.coordinate_mesh) return NextResponse.json({ error: "coordinate_mesh required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data, error } = await anyDb.from("civil_surfaces").insert({
    tenant_id: tenantId,
    project_id: body.project_id,
    surface_type: body.surface_type,
    name: body.name ?? null,
    units: body.units ?? "ft",
    coordinate_mesh: body.coordinate_mesh,
    spot_elevations: body.spot_elevations ?? null,
    created_by: userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { error } = await anyDb.from("civil_surfaces").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
