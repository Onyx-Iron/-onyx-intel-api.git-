import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";
import { hasPermission } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

/**
 * GET  ?project_id=  → list inbound leads (all tenant leads if omitted)
 * POST { project_id?, campaign_id?, source?, contact_name?, contact_phone?,
 *        contact_email?, request_details? } → record a lead manually.
 *
 * A public, unauthenticated capture endpoint (for an actual ad-click landing
 * page / call-tracking webhook) is a natural next step here but out of
 * scope for this pass — this route is for the dashboard's own "Add Lead"
 * action and future webhook wiring.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  let query = anyDb.from("marketing_leads").select("*").eq("tenant_id", tenantId);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    project_id?: string; campaign_id?: string; source?: string;
    contact_name?: string; contact_phone?: string; contact_email?: string; request_details?: string;
  };

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  if (!(await hasPermission(tenantId, userId, "field", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (body.project_id) {
    try {
      await assertProjectBelongsToTenant(body.project_id, tenantId);
    } catch {
      return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
    }
  }
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  if (body.campaign_id) {
    const { data: campaign } = await anyDb
      .from("marketing_campaigns")
      .select("id")
      .eq("id", body.campaign_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!campaign) {
      return NextResponse.json({ error: "campaign_id does not belong to this tenant" }, { status: 403 });
    }
  }

  const { data, error } = await anyDb.from("marketing_leads").insert({
    tenant_id: tenantId,
    project_id: body.project_id ?? null,
    campaign_id: body.campaign_id ?? null,
    source: body.source ?? "manual",
    contact_name: body.contact_name ?? null,
    contact_phone: body.contact_phone ?? null,
    contact_email: body.contact_email ?? null,
    request_details: body.request_details ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
