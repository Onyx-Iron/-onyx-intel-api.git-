import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getTenantConnectionAccessToken } from "@/lib/connections/store";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { captureException } from "@/lib/observability/errors";

export const runtime = "nodejs";

/**
 * GET Search Console searchAnalytics (free) when GSC is connected.
 * Returns empty metrics + connect hint when not connected.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const conn = await getTenantConnectionAccessToken(tenantId, userId, "gsc");
    if (!conn.token || conn.status !== "connected") {
      return NextResponse.json({
        connected: false,
        rows: [],
        hint: conn.status === "error"
          ? `Search Console token needs reconnect: ${conn.detail ?? "refresh failed"}`
          : "Connect Google Search Console under Settings → Connections.",
      });
    }

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 28);
    const body = {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      dimensions: ["query"],
      rowLimit: 25,
    };

    // Site URL discovery
    const sitesRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${conn.token}` },
      cache: "no-store",
    });
    if (!sitesRes.ok) {
      const detail = await sitesRes.text().catch(() => sitesRes.statusText);
      return NextResponse.json({
        connected: true,
        rows: [],
        error: `GSC sites list failed (${sitesRes.status}): ${detail.slice(0, 200)}`,
      }, { status: 502 });
    }
    const sitesData = await sitesRes.json() as { siteEntry?: Array<{ siteUrl?: string }> };
    const siteUrl = sitesData.siteEntry?.[0]?.siteUrl;
    if (!siteUrl) {
      return NextResponse.json({
        connected: true,
        rows: [],
        hint: "No verified sites found in Search Console for this account.",
      });
    }

    const analyticsRes = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${conn.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (!analyticsRes.ok) {
      const detail = await analyticsRes.text().catch(() => analyticsRes.statusText);
      return NextResponse.json({
        connected: true,
        siteUrl,
        rows: [],
        error: `GSC analytics failed (${analyticsRes.status}): ${detail.slice(0, 200)}`,
      }, { status: 502 });
    }

    const analytics = await analyticsRes.json() as {
      rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
    };

    return NextResponse.json({
      connected: true,
      siteUrl,
      rows: (analytics.rows ?? []).map((r) => ({
        query: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      })),
    });
  } catch (err) {
    captureException(err, { route: "GET /api/seo/search-console/metrics" });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
