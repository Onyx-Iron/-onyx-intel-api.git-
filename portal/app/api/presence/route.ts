import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("tenant_presence")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return NextResponse.json({ presence: data ?? null });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "admin", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const row = {
    tenant_id: tenantId,
    website_url: body.website_url ?? null,
    sitemap_url: body.sitemap_url ?? null,
    linkedin_url: body.linkedin_url ?? null,
    facebook_page_id: body.facebook_page_id ?? null,
    instagram_business_id: body.instagram_business_id ?? null,
    gbp_location_name: body.gbp_location_name ?? null,
    indexnow_key: body.indexnow_key ?? null,
    organization_jsonld: body.organization_jsonld ?? {},
    service_areas: body.service_areas ?? [],
    llms_txt_blurb: body.llms_txt_blurb ?? null,
    auto_ingest_plan_email: !!body.auto_ingest_plan_email,
    linkedin_org_posting_enabled: !!body.linkedin_org_posting_enabled,
    updated_at: new Date().toISOString(),
  };

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("tenant_presence")
    .upsert(row, { onConflict: "tenant_id" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ presence: data });
}
