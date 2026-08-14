import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  authTenantKey,
  authTenantName,
  getOrCreateTenant,
} from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { bidOpportunityUpdateSchema, validationMessage } from "@/lib/preconstruction/schema";
import { assertOpportunityLinksBelongToTenant } from "@/lib/preconstruction/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const body = await req.json();
    const parsed = bidOpportunityUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const db = await createServiceClient();
    await assertPermission(tenantId, userId, "financial", "write");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = db as any;
    const { data: current, error: currentError } = await q
      .from("bid_opportunities")
      .select("linked_project_id,linked_estimate_version_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: `[PATCH /api/preconstruction/opportunities/${id}] ${currentError.message}` }, { status: 422 });
    if (!current) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

    const linkedProjectId = Object.hasOwn(parsed.data, "linked_project_id")
      ? parsed.data.linked_project_id ?? null
      : current.linked_project_id ?? null;
    const linkedEstimateVersionId = Object.hasOwn(parsed.data, "linked_estimate_version_id")
      ? parsed.data.linked_estimate_version_id ?? null
      : current.linked_estimate_version_id ?? null;
    await assertOpportunityLinksBelongToTenant(
      db as unknown as Parameters<typeof assertOpportunityLinksBelongToTenant>[0],
      tenantId,
      linkedProjectId,
      linkedEstimateVersionId,
    );

    const { data, error } = await q
      .from("bid_opportunities")
      .update(parsed.data)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*, projects:linked_project_id(id,name,status)")
      .single();

    if (error) return NextResponse.json({ error: `[PATCH /api/preconstruction/opportunities/${id}] ${error.message}` }, { status: 422 });
    return NextResponse.json({ opportunity: data });
  } catch (err: unknown) {
    if (err instanceof PermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
    const msg = err instanceof Error ? err.message : String(err);
    const status = /does not belong|same project/i.test(msg) ? 403 : 500;
    return NextResponse.json({ error: `[PATCH /api/preconstruction/opportunities/[id]] ${msg}` }, { status });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    await assertPermission(tenantId, userId, "financial", "write");
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("bid_opportunities")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: `[DELETE /api/preconstruction/opportunities/${id}] ${error.message}` }, { status: 422 });
    if (!data) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof PermissionError) return NextResponse.json({ error: err.message }, { status: err.status });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[DELETE /api/preconstruction/opportunities/[id]] ${msg}` }, { status: 500 });
  }
}
