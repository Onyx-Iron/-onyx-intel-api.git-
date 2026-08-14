import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { listCurrentEstimateItems, normalizeCurrentEstimateItemForProcurement } from "@/lib/estimating/current-version";
import { getOrCreateTenant, authTenantKey, authTenantName, assertProjectBelongsToTenant } from "@/lib/project-controls/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  try {
    await assertProjectBelongsToTenant(projectId, tenantId);
  } catch {
    return NextResponse.json({ error: "project_id does not belong to this tenant" }, { status: 403 });
  }

  const db = await createServiceClient();
  const items = await listCurrentEstimateItems(db, tenantId, projectId);
  return NextResponse.json({
    rows: items.map(normalizeCurrentEstimateItemForProcurement),
    items,
  });
}
