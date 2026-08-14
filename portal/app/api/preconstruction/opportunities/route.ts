import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  authTenantKey,
  authTenantName,
  getOrCreateTenant,
} from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { parsePagination, paginationMeta } from "@/lib/pagination";
import {
  BID_OPPORTUNITY_STAGES,
  bidOpportunityCreateSchema,
  validationMessage,
} from "@/lib/preconstruction/schema";
import { assertOpportunityLinksBelongToTenant } from "@/lib/preconstruction/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "read");
    const stage = req.nextUrl.searchParams.get("stage");
    const search = req.nextUrl.searchParams.get("q")?.trim();
    const { page, limit, offset } = parsePagination(req.nextUrl.searchParams, 100);
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (db as any)
      .from("bid_opportunities")
      .select("*, projects:linked_project_id(id,name,status)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("bid_due_date", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false });

    if (stage && (BID_OPPORTUNITY_STAGES as readonly string[]).includes(stage)) {
      query = query.eq("stage", stage);
    }
    if (search) {
      const safeSearch = search.slice(0, 100).replaceAll("%", "").replaceAll("_", "");
      query = query.ilike("name", `%${safeSearch}%`);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return NextResponse.json({ error: `[GET /api/preconstruction/opportunities] ${error.message}` }, { status: 500 });

    return NextResponse.json({
      opportunities: data ?? [],
      pagination: paginationMeta(count ?? 0, page, limit),
    });
  } catch (err: unknown) {
    if (err instanceof PermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[GET /api/preconstruction/opportunities] ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = bidOpportunityCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    await assertPermission(tenantId, userId, "financial", "write");
    await assertOpportunityLinksBelongToTenant(
      db as unknown as Parameters<typeof assertOpportunityLinksBelongToTenant>[0],
      tenantId,
      parsed.data.linked_project_id ?? null,
      parsed.data.linked_estimate_version_id ?? null,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("bid_opportunities")
      .insert({
        tenant_id: tenantId,
        created_by: userId,
        stage: "lead",
        priority: "medium",
        ...parsed.data,
      })
      .select("*, projects:linked_project_id(id,name,status)")
      .single();

    if (error) return NextResponse.json({ error: `[POST /api/preconstruction/opportunities] ${error.message}` }, { status: 422 });
    return NextResponse.json({ opportunity: data }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof PermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
    const msg = err instanceof Error ? err.message : String(err);
    const status = /does not belong|same project/i.test(msg) ? 403 : 500;
    return NextResponse.json({ error: `[POST /api/preconstruction/opportunities] ${msg}` }, { status });
  }
}
