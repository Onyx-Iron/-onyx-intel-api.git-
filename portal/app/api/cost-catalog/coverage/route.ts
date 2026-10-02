import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { resolveCostsBatch } from "@/lib/cost/resolver";
import { missingPriceCodes } from "@/lib/cost/coverage";

export const runtime = "nodejs";

/** GET takeoff CSI codes for this tenant that still have no catalog price. */
export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();

  const { data: takeoff, error } = await db
    .from("takeoff_items")
    .select("csi_code")
    .eq("tenant_id", tenantId)
    .not("csi_code", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const takeoffCodes = (takeoff ?? [])
    .map((row) => row.csi_code)
    .filter((code): code is string => Boolean(code));
  const distinct = [...new Set(takeoffCodes)];
  const resolved = distinct.length > 0
    ? await resolveCostsBatch(distinct.map((cost_code) => ({ cost_code, tenant_id: tenantId, region: {} })))
    : [];

  const { data: catalog, error: catalogError } = await db
    .from("cost_catalog")
    .select("csi_code, unit_cost")
    .eq("tenant_id", tenantId);
  if (catalogError) return NextResponse.json({ error: catalogError.message }, { status: 500 });

  const priced = [
    ...resolved.filter((row) => row.source !== "none" && row.unit_cost > 0).map((row) => row.cost_code),
    ...(catalog ?? []).filter((row) => (row.unit_cost ?? 0) > 0 && row.csi_code).map((row) => row.csi_code as string),
  ];
  const missing = missingPriceCodes(distinct, priced);

  return NextResponse.json({
    tenant_id: tenantId,
    takeoff_code_count: distinct.length,
    missing,
  });
}
