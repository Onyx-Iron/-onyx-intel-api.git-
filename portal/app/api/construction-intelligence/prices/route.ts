import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parsePriceObservationInput } from "@/lib/construction-intelligence/price-observations";
import { selectPriceObservation, type PriceApprovalStatus, type PriceObservationCandidate, type PriceSourceKind } from "@/lib/construction-intelligence/pricing";
import { assertProjectBelongsToTenant, authTenantKey, authTenantName, getOrCreateTenant } from "@/lib/project-controls/server";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  project_id: z.string().uuid().optional(),
  cost_code: z.string().trim().min(1).max(50).optional(),
  trade_key: z.string().trim().min(1).max(100).optional(),
  postal_code: z.string().trim().min(3).max(12).optional(),
  metro_code: z.string().trim().min(1).max(50).toUpperCase().optional(),
  state_code: z.string().trim().length(2).toUpperCase().optional(),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

async function identity() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return null;
  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  return { userId, tenantId };
}

function toCandidate(row: {
  id: string;
  source_kind: string;
  approval_status: string;
  effective_date: string;
  expires_at: string | null;
  project_id: string | null;
  postal_code: string | null;
  metro_code: string | null;
  state_code: string | null;
  confidence: number;
}): PriceObservationCandidate {
  return {
    id: row.id,
    sourceKind: row.source_kind as PriceSourceKind,
    approvalStatus: row.approval_status as PriceApprovalStatus,
    effectiveDate: row.effective_date,
    expiresAt: row.expires_at,
    projectId: row.project_id,
    postalCode: row.postal_code,
    metroCode: row.metro_code,
    stateCode: row.state_code,
    confidence: Number(row.confidence),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const actor = await identity();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await assertPermission(actor.tenantId, actor.userId, "financial", "read");
  } catch (error) {
    if (error instanceof PermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
  if (parsed.data.project_id) await assertProjectBelongsToTenant(parsed.data.project_id, actor.tenantId);

  const db = await createServiceClient();
  let query = db.from("price_observations").select("*").eq("tenant_id", actor.tenantId);
  query = parsed.data.project_id
    ? query.or(`project_id.eq.${parsed.data.project_id},project_id.is.null`)
    : query.is("project_id", null);
  if (parsed.data.cost_code) query = query.eq("cost_code", parsed.data.cost_code);
  if (parsed.data.trade_key) query = query.eq("trade_key", parsed.data.trade_key);
  const { data, error } = await query.order("effective_date", { ascending: false }).limit(parsed.data.limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const selected = selectPriceObservation(rows.map(toCandidate), {
    projectId: parsed.data.project_id,
    postalCode: parsed.data.postal_code,
    metroCode: parsed.data.metro_code,
    stateCode: parsed.data.state_code,
    asOfDate: parsed.data.as_of,
  });
  return NextResponse.json({ observations: rows, selected });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const actor = await identity();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await assertPermission(actor.tenantId, actor.userId, "financial", "write");
  } catch (error) {
    if (error instanceof PermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  let observation;
  try {
    observation = parsePriceObservationInput(await request.json().catch(() => null));
  } catch (reason) {
    if (reason instanceof z.ZodError) return NextResponse.json({ error: reason.issues[0]?.message ?? "Invalid price observation" }, { status: 400 });
    throw reason;
  }
  if (observation.project_id) await assertProjectBelongsToTenant(observation.project_id, actor.tenantId);

  const db = await createServiceClient();
  const { data, error } = await db.from("price_observations").insert({
    ...observation,
    tenant_id: actor.tenantId,
    created_by: actor.userId,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ observation: data, authoritative: false, review_required: true }, { status: 201 });
}
