import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { pingIndexNow } from "@/lib/seo/indexNow";
import { logEvent } from "@/lib/activity";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    urls?: string[];
    project_id?: string;
  };
  const urls = (body.urls ?? []).filter((u) => typeof u === "string");
  if (urls.length === 0) {
    return NextResponse.json({ error: "urls required" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: presence } = await (db as any)
    .from("tenant_presence")
    .select("website_url, indexnow_key")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!presence?.indexnow_key || !presence?.website_url) {
    return NextResponse.json({
      error: "Set website_url and indexnow_key in Marketing → SEO / Presence settings first",
    }, { status: 412 });
  }

  let host: string;
  try {
    host = new URL(presence.website_url).host;
  } catch {
    return NextResponse.json({ error: "Invalid website_url" }, { status: 400 });
  }

  const result = await pingIndexNow({
    host,
    key: presence.indexnow_key,
    keyLocation: `${presence.website_url.replace(/\/$/, "")}/${presence.indexnow_key}.txt`,
    urlList: urls,
  });

  if (body.project_id) {
    void logEvent({
      projectId: body.project_id,
      tenantId,
      userId,
      entityType: "seo_ping",
      action: "published",
      title: `IndexNow ping (${urls.length} URL${urls.length === 1 ? "" : "s"})`,
      meta: { href: "/dashboard/marketing", urls, ok: result.ok },
    });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.detail ?? "IndexNow failed", status: result.status }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
