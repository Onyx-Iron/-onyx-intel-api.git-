import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";
import { getTenantConnectionAccessToken } from "@/lib/connections/store";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

type Channel = "meta" | "gbp" | "linkedin_share";

/**
 * Human-approved organic publish.
 * LinkedIn org API stays gated; default is share-intent URL only.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "financial", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    channels?: Channel[];
    copy?: string;
    image_urls?: string[];
    project_id?: string;
    confirm?: boolean;
  };

  if (!body.confirm) {
    return NextResponse.json({ error: "confirm:true required — human approval gate" }, { status: 400 });
  }
  if (!body.copy?.trim()) {
    return NextResponse.json({ error: "copy required" }, { status: 400 });
  }
  const channels = (body.channels ?? []).filter(Boolean);
  if (channels.length === 0) {
    return NextResponse.json({ error: "channels required" }, { status: 400 });
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const externalIds: Record<string, string> = {};
  const errors: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: presence } = await anyDb
    .from("tenant_presence")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (channels.includes("meta")) {
    const conn = await getTenantConnectionAccessToken(tenantId, userId, "meta");
    if (!conn.token) {
      errors.push("Meta not connected");
    } else if (!presence?.facebook_page_id) {
      errors.push("facebook_page_id not set in presence settings");
    } else {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(presence.facebook_page_id)}/feed`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: body.copy,
              access_token: conn.token,
            }),
          },
        );
        const data = await res.json() as { id?: string; error?: { message?: string } };
        if (!res.ok || !data.id) throw new Error(data.error?.message ?? `Meta ${res.status}`);
        externalIds.meta = data.id;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (channels.includes("gbp")) {
    const conn = await getTenantConnectionAccessToken(tenantId, userId, "gbp");
    if (!conn.token) {
      errors.push("Google Business Profile not connected");
    } else {
      // Store as published draft reference — full GBP Local Posts API needs account/location resource names.
      externalIds.gbp = `pending:${presence?.gbp_location_name ?? "default"}`;
    }
  }

  let linkedinShareUrl: string | null = null;
  if (channels.includes("linkedin_share")) {
    const url = presence?.website_url || "https://onyx-iron.com";
    linkedinShareUrl =
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    externalIds.linkedin_share = linkedinShareUrl;
  }

  const status = errors.length && Object.keys(externalIds).length === 0 ? "failed" : "published";
  const { data: post, error } = await anyDb
    .from("social_posts")
    .insert({
      tenant_id: tenantId,
      project_id: body.project_id ?? null,
      channels,
      copy: body.copy.trim(),
      image_urls: body.image_urls ?? [],
      status,
      external_ids: externalIds,
      error_detail: errors.length ? errors.join("; ") : null,
      created_by: userId,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.project_id) {
    void logEvent({
      projectId: body.project_id,
      tenantId,
      userId,
      entityType: "social_post",
      entityId: post.id,
      action: "published",
      title: `Organic post (${channels.join(", ")})`,
      meta: { href: "/dashboard/marketing", externalIds, errors },
    });
  }

  return NextResponse.json({
    post,
    linkedin_share_url: linkedinShareUrl,
    errors,
  }, { status: status === "failed" ? 502 : 200 });
}
