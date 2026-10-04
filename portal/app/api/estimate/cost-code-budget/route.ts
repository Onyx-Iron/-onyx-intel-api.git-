import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant,
} from "@/lib/project-controls/server";
import { ownershipDenied } from "@/lib/project-controls/route-guards";
import { costCodeBudget } from "@/lib/estimating/cost-code-budget";

export const runtime = "nodejs";

/** Read-only rollup. This route does not write estimate_items. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try { await assertProjectBelongsToTenant(projectId, tenantId); }
  catch (err) {
    const owned = ownershipDenied(err);
    if (owned) return owned;
    throw err;
  }

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data: estimate } = await anyDb
    .from("estimates")
    .select("current_version_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const versionId = estimate?.current_version_id ?? null;
  const [itemsRes, changesRes, ordersRes, invoicesRes] = await Promise.all([
    versionId
      ? anyDb.from("estimate_items").select("cost_code, total_price").eq("tenant_id", tenantId).eq("estimate_version_id", versionId)
      : Promise.resolve({ data: [], error: null }),
    anyDb.from("change_order_items").select("cost_code, amount, status").eq("tenant_id", tenantId).eq("project_id", projectId),
    anyDb.from("purchase_orders").select("cost_code, total_amount").eq("tenant_id", tenantId).eq("project_id", projectId),
    anyDb.from("invoices").select("cost_code, amount, direction").eq("tenant_id", tenantId).eq("project_id", projectId),
  ]);
  const failed = [itemsRes, changesRes, ordersRes, invoicesRes].find((result) => result.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const rows = costCodeBudget({
    estimateItems: itemsRes.data ?? [],
    changeItems: changesRes.data ?? [],
    purchaseOrders: ordersRes.data ?? [],
    invoices: invoicesRes.data ?? [],
  });
  return NextResponse.json({ rows });
}
