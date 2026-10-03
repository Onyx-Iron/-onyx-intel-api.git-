import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

async function ensureDefaultLayer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  projectId: string,
  userId: string,
) {
  const { data: existing } = await db
    .from("takeoff_layers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("name", "Unassigned")
    .maybeSingle();
  if (existing) return existing;
  const { data } = await db
    .from("takeoff_layers")
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      name: "Unassigned",
      color: "#9CA3AF",
      sort_order: 0,
      created_by: userId,
    })
    .select("*")
    .single();
  return data;
}

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
  const anyDb = db as any;
  await ensureDefaultLayer(anyDb, tenantId, projectId, userId);
  const { data, error } = await anyDb
    .from("takeoff_layers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layers: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    project_id?: string;
    name?: string;
    color?: string;
    default_cost_code?: string;
  };
  if (!body.project_id || !body.name?.trim()) {
    return NextResponse.json({ error: "project_id and name required" }, { status: 400 });
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
    .from("takeoff_layers")
    .insert({
      tenant_id: tenantId,
      project_id: body.project_id,
      name: body.name.trim(),
      color: body.color ?? "#CCFF00",
      default_cost_code: body.default_cost_code ?? null,
      created_by: userId,
      sort_order: 100,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layer: data }, { status: 201 });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    id?: string;
    visible?: boolean;
    locked?: boolean;
    name?: string;
    color?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId };
  if (typeof body.visible === "boolean") patch.visible = body.visible;
  if (typeof body.locked === "boolean") patch.locked = body.locked;
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.color === "string") patch.color = body.color;

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("takeoff_layers")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", body.id)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ layer: data });
}
