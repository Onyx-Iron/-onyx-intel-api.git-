import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { getUserRole } from "@/lib/project-controls/permissions";
import { redactOpportunityRows } from "@/lib/project-controls/financial-redaction";
import { isBidStage } from "@/lib/preconstruction/stages";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("bid_opportunities")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const role = await getUserRole(tenantId, userId);
  const [opportunity] = redactOpportunityRows([data as Record<string, unknown>], role);
  return NextResponse.json({ opportunity });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of [
    "name", "client_name", "due_at", "bid_value", "win_probability",
    "project_id", "assigned_to", "notes", "source", "source_ref", "meta",
  ]) {
    if (key in body) patch[key] = body[key];
  }
  if (typeof body.stage === "string") {
    if (!isBidStage(body.stage)) {
      return NextResponse.json({ error: "invalid stage" }, { status: 400 });
    }
    patch.stage = body.stage;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("bid_opportunities")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (data.project_id) {
    void logEvent({
      projectId: data.project_id,
      tenantId,
      userId,
      entityType: "bid_opportunity",
      entityId: data.id,
      action: "stage" in patch ? "status_changed" : "updated",
      title: `Bid opportunity updated: ${data.name}`,
      meta: { href: "/dashboard/preconstruction", stage: data.stage },
    });
  }

  return NextResponse.json({ opportunity: data });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from("bid_opportunities")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
