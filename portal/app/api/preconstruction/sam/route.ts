import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

/**
 * Free SAM.gov opportunity search → preview rows (approve to create bid cards).
 * Uses the public SAM API when SAM_API_KEY is set; otherwise returns structured empty + hint.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));

  const q = req.nextUrl.searchParams.get("q") ?? "construction";
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      notices: [],
      hint: "Set free SAM_API_KEY from https://sam.gov to enable live federal bid search.",
    });
  }

  const url = new URL("https://api.sam.gov/opportunities/v2/search");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("keyword", q);
  url.searchParams.set("limit", "10");
  url.searchParams.set("postedFrom", formatSamDate(daysAgo(30)));
  url.searchParams.set("postedTo", formatSamDate(new Date()));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    return NextResponse.json({ error: `SAM.gov ${res.status}: ${detail.slice(0, 200)}` }, { status: 502 });
  }
  const data = await res.json() as {
    opportunitiesData?: Array<{
      noticeId?: string;
      title?: string;
      fullParentPathName?: string;
      responseDeadLine?: string;
      uiLink?: string;
    }>;
  };

  const notices = (data.opportunitiesData ?? []).map((n) => ({
    source_ref: n.noticeId ?? "",
    name: n.title ?? "Untitled notice",
    client_name: n.fullParentPathName ?? null,
    due_at: n.responseDeadLine ?? null,
    url: n.uiLink ?? null,
  }));

  return NextResponse.json({ notices });
}

/** POST { notices: [...] } — create bid_opportunities with source=sam (human approve). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    notices?: Array<{ name: string; client_name?: string; due_at?: string; source_ref?: string; url?: string }>;
  };
  const notices = body.notices ?? [];
  if (notices.length === 0) {
    return NextResponse.json({ error: "notices required" }, { status: 400 });
  }

  const db = await createServiceClient();
  const rows = notices.map((n) => ({
    tenant_id: tenantId,
    name: n.name,
    client_name: n.client_name ?? null,
    due_at: n.due_at ?? null,
    stage: "identified",
    source: "sam",
    source_ref: n.source_ref ?? null,
    meta: { url: n.url ?? null },
    created_by: userId,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("bid_opportunities")
    .insert(rows)
    .select("id, name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ created: data ?? [] }, { status: 201 });
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function formatSamDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
