import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * User-facing manual retry for a failed/dead-lettered estimate-sync outbox
 * event (STEP 15 — "Retry failed sync where authorized"). Tenant-scoped:
 * retry_outbox_event itself re-checks tenant_id server-side, so a
 * cross-tenant retry attempt is denied at the RPC layer even if this route
 * had a bug in its own scoping.
 *
 * POST { id: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).rpc("retry_outbox_event", { p_id: body.id, p_tenant_id: tenantId });
  if (error) {
    if (error.message?.includes("not found")) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
