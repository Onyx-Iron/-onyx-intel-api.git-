import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { requirePermission } from "@/lib/project-controls/route-guards";

export const runtime = "nodejs";

/**
 * Pricing Matrix — `project_estimates` + `project_financial_settings`.
 *
 * DEPRECATED as of the estimating-core-consolidation milestone:
 * `estimate_items` + `estimate_versions` is now the one authoritative
 * estimating system (see docs/milestones/estimating-core-consolidation/).
 * This route is READ-ONLY going forward — GET still serves historical data
 * so existing links/exports don't break, but POST/PATCH/DELETE are
 * disabled (410) rather than silently accepting writes nobody will see
 * reflected in the authoritative estimate. Existing rows were migrated
 * into estimate_items as a draft version; do not add new writes here.
 *
 * GET ?project_id= → { rows, settings } (legacy, historical only)
 */

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const [rowsRes, settingsRes] = await Promise.all([
    anyDb.from("project_estimates")
      .select("*")
      .eq("tenant_id", tenantId).eq("project_id", projectId)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
    anyDb.from("project_financial_settings")
      .select("*")
      .eq("tenant_id", tenantId).eq("project_id", projectId)
      .maybeSingle(),
  ]);

  const settings = settingsRes.data ?? {
    project_id: projectId,
    overhead_pct: 10,
    profit_pct: 15,
    contingency_pct: 5,
  };
  return NextResponse.json({ rows: rowsRes.data ?? [], settings });
}

const DEPRECATED_MESSAGE =
  "project_estimates (Pricing Matrix) is deprecated and read-only. Use /api/estimate/versions to write to the authoritative estimate_items/estimate_versions system instead.";

async function gateDeprecatedWrite(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const denied = await requirePermission(tenantId, userId, "financial", "write");
  if (denied) return denied;
  return NextResponse.json({ error: DEPRECATED_MESSAGE }, { status: 410 });
}

export async function POST(): Promise<NextResponse> {
  return gateDeprecatedWrite();
}

export async function PATCH(): Promise<NextResponse> {
  return gateDeprecatedWrite();
}

export async function DELETE(): Promise<NextResponse> {
  return gateDeprecatedWrite();
}
