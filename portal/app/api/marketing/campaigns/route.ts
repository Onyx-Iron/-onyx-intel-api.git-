import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { launchCampaign, isGoogleAdsConfigured, isMetaConfigured, AdPlatformNotConfiguredError } from "@/lib/marketing/adPlatforms";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

/**
 * GET  ?project_id=  → list campaigns (all tenant campaigns if omitted)
 * POST { project_id?, platform, campaign_name, budget_daily, creative }
 *      → creates a draft row, then attempts to launch it on the real ad
 *        platform. If the platform isn't configured, the row is still saved
 *        as status="draft" with a clear reason — nothing is silently faked.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  let query = anyDb.from("marketing_campaigns").select("*").eq("tenant_id", tenantId);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    campaigns: data ?? [],
    platforms: { google_ads: isGoogleAdsConfigured(), meta: isMetaConfigured() },
  });
}

interface CampaignBody {
  project_id?: string | null;
  platform?: "google_ads" | "meta";
  campaign_name?: string;
  budget_daily?: number;
  creative?: { image_urls?: string[]; copy?: string; radius_miles?: number; lat?: number; lng?: number };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as CampaignBody;
  if (body.platform !== "google_ads" && body.platform !== "meta") {
    return NextResponse.json({ error: "platform must be 'google_ads' or 'meta'" }, { status: 400 });
  }
  if (!body.campaign_name) return NextResponse.json({ error: "campaign_name required" }, { status: 400 });
  if (typeof body.budget_daily !== "number" || body.budget_daily <= 0) return NextResponse.json({ error: "budget_daily must be > 0" }, { status: 400 });
  const creative = body.creative ?? {};
  if (typeof creative.lat !== "number" || typeof creative.lng !== "number") {
    return NextResponse.json({ error: "creative.lat and creative.lng are required for geo-targeting" }, { status: 400 });
  }

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

  const { data: created, error: insErr } = await anyDb.from("marketing_campaigns").insert({
    tenant_id: tenantId,
    company_id: tenantId,
    project_id: body.project_id ?? null,
    platform: body.platform,
    campaign_name: body.campaign_name,
    budget_daily: body.budget_daily,
    status: "draft",
    creative,
    created_by: userId,
  }).select("*").single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  let launchError: string | null = null;
  try {
    const result = await launchCampaign(body.platform, {
      campaignName: body.campaign_name,
      budgetDaily: body.budget_daily,
      creative: {
        imageUrls: creative.image_urls ?? [],
        copy: creative.copy ?? "",
        radiusMiles: creative.radius_miles ?? 10,
        lat: creative.lat,
        lng: creative.lng,
      },
    });
    await anyDb.from("marketing_campaigns").update({
      status: result.status,
      external_campaign_id: result.externalCampaignId,
      last_synced_at: new Date().toISOString(),
    }).eq("id", created.id);
  } catch (e) {
    launchError = e instanceof Error ? e.message : String(e);
    const isConfigError = e instanceof AdPlatformNotConfiguredError;
    await anyDb.from("marketing_campaigns").update({
      status: isConfigError ? "draft" : "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", created.id);
  }

  void logEvent({
    projectId: body.project_id ?? created.id,
    tenantId, userId,
    entityType: "project",
    entityId: created.id,
    action: "created",
    title: `Marketing campaign "${body.campaign_name}" ${launchError ? "saved as draft" : "launched"} on ${body.platform}`,
    meta: { platform: body.platform, launch_error: launchError },
  });

  const { data: finalRow } = await anyDb.from("marketing_campaigns").select("*").eq("id", created.id).single();
  return NextResponse.json({ ok: !launchError, campaign: finalRow, launch_error: launchError });
}
