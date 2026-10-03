import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
  assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { requirePermission, ownershipDenied } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

/**
 * Manual resync trigger. Takeoff writes already auto-sync into estimate_items
 * (see lib/estimating/auto-sync.ts), so this endpoint mostly exists as a
 * user-visible "force resync" — e.g. after seeding cost_catalog rates so
 * previously-unpriced items get re-priced. Idempotent, safe to call anytime.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { project_id?: string };
    if (!body.project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const denied = await requirePermission(tenantId, userId, "financial", "write");
    if (denied) return denied;
    await assertProjectBelongsToTenant(body.project_id, tenantId);

    const result = await syncTakeoffToEstimate(tenantId, body.project_id);

    return NextResponse.json(result, { status: result.imported > 0 ? 201 : 200 });
  } catch (err: unknown) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/estimate/import-takeoff] ${msg}` }, { status: 500 });
  }
}
