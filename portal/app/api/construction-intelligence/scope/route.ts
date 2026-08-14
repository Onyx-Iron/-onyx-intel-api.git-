import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectBelongsToTenant, authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { createServiceClient } from "@/lib/supabase/server";
import { estimateScopeWorkUnits, normalizeScopeSelection, validateScopeSelection } from "@/lib/construction-intelligence/scope";
import { MASTERFORMAT_DIVISIONS } from "@/lib/construction-intelligence/taxonomy";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scopeSchema = z.object({
  project_id: z.string().uuid(),
  mode: z.enum(["all_scopes", "selected_trades", "bid_packages", "selected_documents", "alternates"]),
  division_codes: z.array(z.string().max(2)).max(50).default([]),
  trade_keys: z.array(z.string().max(100)).max(100).default([]),
  bid_package_ids: z.array(z.string().max(100)).max(100).default([]),
  document_ids: z.array(z.string().uuid()).max(200).default([]),
  sheet_ids: z.array(z.string().uuid()).max(2000).default([]),
  alternate_keys: z.array(z.string().max(100)).max(100).default([]),
});

async function identity() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return null;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  return { userId, tenantId };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await identity();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ divisions: MASTERFORMAT_DIVISIONS, latest: null });
  await assertProjectBelongsToTenant(projectId, actor.tenantId);
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scopeDb = db as any;
  const { data, error } = await scopeDb.from("takeoff_scope_requests").select("*").eq("tenant_id", actor.tenantId).eq("project_id", projectId).in("status", ["confirmed", "running", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ divisions: MASTERFORMAT_DIVISIONS, latest: data ?? null });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await identity();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await assertPermission(actor.tenantId, actor.userId, "field", "write");
    const parsed = scopeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid scope" }, { status: 400 });
    await assertProjectBelongsToTenant(parsed.data.project_id, actor.tenantId);
    const selection = normalizeScopeSelection({ mode: parsed.data.mode, divisionCodes: parsed.data.division_codes, tradeKeys: parsed.data.trade_keys, bidPackageIds: parsed.data.bid_package_ids, documentIds: parsed.data.document_ids, sheetIds: parsed.data.sheet_ids, alternateKeys: parsed.data.alternate_keys });
    const errors = validateScopeSelection(selection);
    if (errors.length) return NextResponse.json({ error: errors[0] }, { status: 400 });
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopeDb = db as any;
    const { data, error } = await scopeDb.from("takeoff_scope_requests").insert({ tenant_id: actor.tenantId, project_id: parsed.data.project_id, requested_by: actor.userId, mode: selection.mode, division_codes: selection.divisionCodes, trade_keys: selection.tradeKeys, bid_package_ids: selection.bidPackageIds, document_ids: selection.documentIds, sheet_ids: selection.sheetIds, alternate_keys: selection.alternateKeys, estimated_work_units: estimateScopeWorkUnits(selection), status: "confirmed", confirmed_at: new Date().toISOString() }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ scope: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof PermissionError ? 403 : 500 },
    );
  }
}
