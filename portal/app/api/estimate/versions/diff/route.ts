import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { canReadFinancial, getUserRole } from "@/lib/project-controls/permissions";
import { getServiceDb, loadVersionForTenant, NotFoundError } from "@/lib/estimating/versioning";
import { diffEstimateVersions, type VersionDiff, type VersionDiffItem } from "@/lib/estimating/version-diff";

export const runtime = "nodejs";

function stripDiffMoney(diff: VersionDiff): VersionDiff {
  const stripItem = (item: VersionDiffItem): VersionDiffItem => ({
    ...item,
    unit_cost: null,
    total_price: null,
  });
  return {
    added: diff.added.map(stripItem),
    removed: diff.removed.map(stripItem),
    unchangedCount: diff.unchangedCount,
    changed: diff.changed.map((change) => ({
      ...change,
      left: stripItem(change.left),
      right: stripItem(change.right),
      changes: change.changes.filter((kind) => kind === "quantity" || kind === "source"),
      unitCostDelta: null,
      totalDelta: null,
    })),
  };
}

async function loadItems(db: Awaited<ReturnType<typeof getServiceDb>>, versionId: string): Promise<VersionDiffItem[]> {
  const { data, error } = await db
    .from("estimate_items")
    .select("id, source_takeoff_id, csi_code, description, quantity, unit_cost, total_price, drawing_ref, quantity_basis")
    .eq("estimate_version_id", versionId);
  if (error) throw new Error(error.message);
  return (data ?? []) as VersionDiffItem[];
}

/** GET /api/estimate/versions/diff?left=&right= — tenant-scoped item diff. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const left = req.nextUrl.searchParams.get("left");
  const right = req.nextUrl.searchParams.get("right");
  if (!left || !right) {
    return NextResponse.json({ error: "left and right version ids are required" }, { status: 400 });
  }

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await getServiceDb();

  try {
    const [leftVersion, rightVersion] = await Promise.all([
      loadVersionForTenant(db, left, tenantId),
      loadVersionForTenant(db, right, tenantId),
    ]);
    const [leftItems, rightItems] = await Promise.all([
      loadItems(db, leftVersion.id),
      loadItems(db, rightVersion.id),
    ]);
    const diff = diffEstimateVersions(leftItems, rightItems);
    const canRead = canReadFinancial(await getUserRole(tenantId, userId));
    return NextResponse.json({
      left: leftVersion.id,
      right: rightVersion.id,
      tenant_id: tenantId,
      diff: canRead ? diff : stripDiffMoney(diff),
      financials_redacted: !canRead,
    });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    const message = e instanceof Error ? e.message : "Diff failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
