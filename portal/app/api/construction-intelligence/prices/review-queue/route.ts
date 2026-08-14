import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertPermission(tenantId, userId, "financial", "read");
  } catch (error) {
    if (error instanceof PermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceDb = db as any;
  const { data, error } = await priceDb.from("price_observations").select("*")
    .eq("tenant_id", tenantId).eq("approval_status", "unreviewed")
    .order("created_at", { ascending: true }).limit(250);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ observations: data ?? [] });
}
