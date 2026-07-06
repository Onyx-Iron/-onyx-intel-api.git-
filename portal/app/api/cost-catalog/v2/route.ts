import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateTenant,
  authTenantKey,
  authTenantName,
} from "@/lib/project-controls/server";
import { resolveCostsBatch, type CostResolveResult } from "@/lib/cost/resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Service-to-service auth: Railway/Python service sends
//   Authorization: Bearer <SUPABASE_SERVICE_KEY or ONYX_INTERNAL_KEY>
//   X-Onyx-Tenant: <tenant uuid>
// and bypasses Clerk. Falls back to Clerk session for user-facing calls.
function getServiceTenantId(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const validTokens = [
    process.env.SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.ONYX_INTERNAL_KEY,
  ].filter(Boolean);
  if (!validTokens.includes(token)) return null;
  const tenant = req.headers.get("x-onyx-tenant")?.trim();
  return tenant && tenant.length > 0 ? tenant : "_global";
}

// GET /api/cost-catalog/v2?cost_codes=03-30-00,05-12-00&zip=75201&state=TX&metro=DAL
// Batch resolver returning one CostResolveResult per code.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    let tenantId = getServiceTenantId(req);
    if (!tenantId) {
      const { userId, orgId, orgSlug } = await auth();
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      tenantId = await getOrCreateTenant(
        authTenantKey(userId, orgId),
        authTenantName(userId, orgSlug),
      );
    }

    const sp = req.nextUrl.searchParams;
    // Accept either `cost_codes` (plural, comma-separated) or `csi_code` (singular)
    const raw = sp.get("cost_codes") ?? sp.get("csi_code") ?? "";
    const codes = raw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (codes.length === 0) {
      return NextResponse.json(
        { error: "cost_codes required (comma-separated)" },
        { status: 400 },
      );
    }
    const zip = sp.get("zip") ?? undefined;
    const state = sp.get("state") ?? undefined;
    const metro = sp.get("metro") ?? undefined;

    // Batched: resolves the full precedence cascade (tenant overrides →
    // actuals → regional → national) for all codes in a handful of queries
    // total instead of up to 6 sequential round trips PER code.
    const results: CostResolveResult[] = await resolveCostsBatch(
      codes.map((code) => ({
        cost_code: code,
        tenant_id: tenantId,
        region: { zip, state, metro },
      })),
    );

    return NextResponse.json({ items: results });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
