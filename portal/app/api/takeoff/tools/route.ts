import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";
import { isToolKind } from "@/lib/takeoff/canvas/tool-chest";

export const runtime = "nodejs";

const COST_CODE_RE = /^\d{2}-\d{2}-\d{2}$/;

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
    .from("takeoff_tools")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tools: data ?? [] });
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
    cost_code?: string;
    unit?: string;
    tool?: string;
  };
  if (!body.project_id || !body.name?.trim() || !body.tool || !isToolKind(body.tool)) {
    return NextResponse.json({ error: "project_id, name, and tool (count, length, or area) required" }, { status: 400 });
  }
  if (!body.cost_code || !COST_CODE_RE.test(body.cost_code)) {
    return NextResponse.json({ error: "cost_code must be NN-NN-NN" }, { status: 400 });
  }
  try { await assertProjectBelongsToTenant(body.project_id, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const unit = body.unit?.trim()
    || (body.tool === "count" ? "EA" : body.tool === "area" ? "SF" : "LF");
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("takeoff_tools")
    .insert({
      tenant_id: tenantId,
      project_id: body.project_id,
      name: body.name.trim(),
      cost_code: body.cost_code,
      unit,
      tool: body.tool,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tool: data }, { status: 201 });
}
