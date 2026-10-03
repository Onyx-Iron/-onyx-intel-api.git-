import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST { document_ids: string[] } — merges into meta.document_ids */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "field", "write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as { document_ids?: string[] };
  const ids = (body.document_ids ?? []).filter((x) => typeof x === "string");
  if (ids.length === 0) {
    return NextResponse.json({ error: "document_ids required" }, { status: 400 });
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data: opp, error: oppErr } = await anyDb
    .from("bid_opportunities")
    .select("id, meta")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (oppErr) return NextResponse.json({ error: oppErr.message }, { status: 500 });
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const prev = (opp.meta?.document_ids as string[] | undefined) ?? [];
  const merged = Array.from(new Set([...prev, ...ids]));
  const { data, error } = await anyDb
    .from("bid_opportunities")
    .update({
      meta: { ...(opp.meta ?? {}), document_ids: merged },
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ opportunity: data });
}
