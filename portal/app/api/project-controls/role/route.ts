import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { getUserRole } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";

/** GET /api/project-controls/role — the caller's operational role for their tenant. */
export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug, orgRole } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const role = await getUserRole(tenantId, userId, { orgId, orgRole });
  return NextResponse.json({ role });
}
